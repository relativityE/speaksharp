// The real runner's own preflight, run BEFORE ANY Stripe call and independently of the app's payment gate
// (Sam, smoke review of c9898bf8 + 65e9fa28). It never reaches a provider: the only network it may touch is
// the loopback Supabase stack, and every address is checked before it is fetched.
//
// 1. Keys: only a Stripe TEST secret key and TEST publishable key; anything live, restricted or malformed
//    is refused.
// 2. Keys match the stack: the runner's secret key and Pro price are the ones this run's local Edge functions
//    were served with (sha256 fingerprints the workflow wrote when it wrote the functions env), so the
//    runner cannot drive one Stripe account while the backend talks to another.
// 3. Isolated backend: the Supabase URL is the loopback CLI stack, the anon and service keys are the local
//    CLI's own (issuer supabase-demo, the right roles, no hosted project ref), and the local Auth health and
//    Edge function gateway answer from loopback.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';

const { AbortSignal } = globalThis;

export class PreflightError extends Error {
  constructor(code) { super(`BILLING_JOURNEY:${code}`); this.code = code; }
}
const fail = (code) => { throw new PreflightError(code); };
const need = (value, code) => { if (!value) fail(code); };

export const LOCAL_API_ORIGINS = Object.freeze(['http://127.0.0.1:54321', 'http://localhost:54321']);
const SECRET = /^sk_test_[A-Za-z0-9]{24,247}$/;
const PUBLISHABLE = /^pk_test_[A-Za-z0-9]{24,247}$/;
const PRICE = /^price_[A-Za-z0-9]{8,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const fingerprint = (value) => createHash('sha256').update(String(value)).digest('hex');

/** 1. Only test keys. Checked on the raw strings, before anything else. */
export function assertTestKeys(env) {
  const secret = env.BILLING_SANDBOX_STRIPE_KEY ?? '';
  const publishable = env.BILLING_SANDBOX_PUBLISHABLE_KEY ?? '';
  for (const key of [secret, publishable]) {
    need(!/^(sk|pk|rk)_live_/.test(key) && !/^rk_/.test(key), 'live_or_restricted_key_refused');
  }
  need(SECRET.test(secret), 'test_secret_key_required');
  need(PUBLISHABLE.test(publishable), 'test_publishable_key_required');
  need(PRICE.test(env.BILLING_SANDBOX_PRICE_ID ?? ''), 'price_id_malformed');
}

/** 2. The runner's key and price are exactly the ones the local Edge functions were served with. */
export function assertKeysMatchStack(env) {
  const keyPrint = env.BILLING_LOCAL_FUNCTIONS_STRIPE_KEY_SHA256 ?? '';
  const pricePrint = env.BILLING_LOCAL_FUNCTIONS_PRICE_SHA256 ?? '';
  need(SHA256.test(keyPrint) && SHA256.test(pricePrint), 'stack_key_fingerprint_missing');
  need(fingerprint(env.BILLING_SANDBOX_STRIPE_KEY) === keyPrint, 'stripe_key_mismatch_with_stack');
  need(fingerprint(env.BILLING_SANDBOX_PRICE_ID) === pricePrint, 'price_mismatch_with_stack');
}

function jwtPayload(token, code) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  need(parts.length === 3, code);
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return fail(code); }
}

/** 3a. The Supabase keys are the local CLI's, not a hosted project's. Decoded only; never sent anywhere. */
export function assertLocalSupabaseKeys(env) {
  let url;
  try { url = new URL(env.BILLING_SANDBOX_SUPABASE_URL ?? ''); } catch { return fail('supabase_url_invalid'); }
  const origin = url.origin;
  need(LOCAL_API_ORIGINS.includes(origin) && url.pathname === '/' && !url.search && !url.hash
    && !url.username && !url.password, 'supabase_not_loopback');
  const anon = jwtPayload(env.BILLING_SANDBOX_ANON_KEY, 'anon_key_not_local');
  const service = jwtPayload(env.BILLING_SANDBOX_SERVICE_ROLE_KEY, 'service_key_not_local');
  need(anon.iss === 'supabase-demo' && anon.role === 'anon' && !('ref' in anon), 'anon_key_not_local');
  need(service.iss === 'supabase-demo' && service.role === 'service_role' && !('ref' in service), 'service_key_not_local');
  return origin;
}

/** 3b. The loopback stack answers. Every address is checked as loopback before it is fetched. */
export async function probeLocalBackend(origin, anonKey, fetchImpl) {
  const get = async (path, init) => {
    const url = new URL(path, origin);
    need(LOCAL_API_ORIGINS.includes(url.origin), 'probe_not_loopback');
    let response;
    try { response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(10_000), ...init }); }
    catch { return fail('local_backend_unreachable'); }
    return response;
  };
  const health = await get('/auth/v1/health', { headers: { apikey: anonKey } });
  need(health.status === 200, 'local_auth_unhealthy');
  const gateway = await get('/functions/v1/stripe-checkout', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
  need(gateway.status === 200 || gateway.status === 204, 'local_functions_unavailable');
}

/**
 * Runs 1, 2 and 3 in order. The first failure stops everything, so a live or mismatched key never reaches
 * even the loopback probes, and nothing at all reaches Stripe.
 */
export async function runnerPreflight(env, fetchImpl = globalThis.fetch) {
  assertTestKeys(env);
  assertKeysMatchStack(env);
  const origin = assertLocalSupabaseKeys(env);
  await probeLocalBackend(origin, env.BILLING_SANDBOX_ANON_KEY, fetchImpl);
  return { api: origin, keyClass: 'test', keysMatchStack: true, backend: 'loopback' };
}
