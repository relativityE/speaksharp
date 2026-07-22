/**
 * Canary provisioning core — SIGN-IN-FIRST, testable, content-free, FAIL-CLOSED.
 *
 * Evidence-based context (do NOT overstate): a contemporaneous read-only control (Test User Admin
 * `query` → admin.listUsers) using the SAME url/service-role key PASSED while the canary FAILED. That
 * proves the credential and the Auth-admin listUsers path were NOT globally invalid — it does NOT prove
 * the exact transient mechanism of the canary's invalid-JWT, which remains unproven. Sign-in-first
 * simply removes unnecessary admin dependency from the healthy path.
 *
 * Guarantees:
 *  - Healthy path uses ONLY the public anon flow (sign in + read own profile). No admin mutation.
 *  - Sign-in failures are CLASSIFIED before any recovery: auth/config (401/403/invalid-JWT/anon-key) →
 *    STOP, never mutate; transient (network/429/5xx) → bounded retry, then fail WITHOUT mutation; only a
 *    deterministic invalid-credentials/account-unavailable result → recovery.
 *  - Recovery is existence-FIRST (admin lookup), then update-only (existing) or create-only (missing) —
 *    never uses a createUser conflict as the existence test, never touches a non-canary account.
 *  - Tier verification FAILS CLOSED: a query error, missing profile, null/unknown, or non-free tier is
 *    NOT healthy. provisionCanary consumes and enforces it.
 * No credentials, tokens, JWT claims, or user records are returned/logged.
 */

const CANARY_EMAIL_RE = /^canary(-.+)?@speaksharp\.app$/i;

/**
 * Classify a Supabase error into an actionable, content-free category.
 * Categories: 'auth_config' (stop, config problem), 'retryable' (transient), 'recoverable_credentials'
 * (the ONLY category that may authorize canary recovery), 'other' (unknown/unclassified → fail closed).
 */
export function classifyError(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const code = (error?.code || error?.error_code || '').toString().toLowerCase();
  const msg = (error?.message || '').toLowerCase();
  const isAuthConfig =
    status === 401 || status === 403 ||
    msg.includes('invalid jwt') || msg.includes('unrecognized') ||
    msg.includes('unable to parse or verify signature') || msg.includes('token is unverifiable') ||
    msg.includes('invalid api key') || msg.includes('no api key');
  if (isAuthConfig) return { status, category: 'auth_config', retryable: false };
  const isRetryable =
    status === 429 || (typeof status === 'number' && status >= 500) ||
    msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset');
  if (isRetryable) return { status, category: 'retryable', retryable: true };
  // EXPLICITLY recognized "the canary's own credentials/account are invalid or unavailable". This is the
  // ONLY category permitted to trigger (canary-only, existence-first) recovery. Matched by Supabase error
  // code first, then a small allowlist of stable auth messages — never a bare status like 400.
  const isRecoverableCreds =
    code === 'invalid_credentials' || code === 'email_not_confirmed' || code === 'user_not_found' ||
    msg.includes('invalid login credentials') || msg.includes('email not confirmed') ||
    msg.includes('user not found') || msg.includes('user is unavailable') || msg.includes('account not found');
  if (isRecoverableCreds) return { status, category: 'recoverable_credentials', retryable: false };
  // Everything else — unknown 4xx, malformed/empty errors, unexpected non-retryable — FAILS CLOSED.
  return { status, category: 'other', retryable: false };
}

/** Retry a {data,error}-returning op ONLY on retryable errors (never 401/403/invalid-JWT/deterministic). */
export async function withRetry(fn, { attempts = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    const { data, error } = await fn();
    if (!error) return { data, error: null };
    last = error;
    const c = classifyError(error);
    if (!c.retryable) return { data: null, error, classification: c };
    if (i < attempts) await sleep(300 * i);
  }
  return { data: null, error: last, classification: classifyError(last) };
}

async function signInOnce(anon, { email, password }) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error, classification: classifyError(error) };
  const userId = data?.user?.id;
  if (!userId) return { ok: false, error: new Error('no user in session'), classification: { category: 'other', retryable: false } };
  return { ok: true, userId };
}

/** Sign in via the anon flow with bounded retry on TRANSIENT errors only (never auth/config/deterministic). */
export async function signInWithBoundedRetry(anon, creds, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let cls = null;
  for (let i = 1; i <= attempts; i++) {
    const r = await signInOnce(anon, creds);
    if (r.ok) return r;
    cls = r.classification;
    if (!cls.retryable) return { ok: false, classification: cls }; // auth/config or deterministic → stop
    if (i < attempts) await sleep(300 * i);
  }
  return { ok: false, classification: cls }; // transient exhausted
}

/** Verify the signed-in canary's own tier. FAIL-CLOSED: error / missing / null / non-free is NOT healthy. */
export async function verifyTier(anon, userId) {
  const { data, error } = await anon.from('user_profiles').select('subscription_status').eq('id', userId).maybeSingle();
  if (error) return { ok: false, tier: null, reason: `profile query error [${classifyError(error).category}]` };
  const tier = data?.subscription_status ?? null;
  if (tier === null) return { ok: false, tier: null, reason: 'profile missing or subscription_status null' };
  if (tier !== 'free') return { ok: false, tier, reason: `unexpected tier '${tier}' (expected free)` };
  return { ok: true, tier };
}

/** Existence-FIRST admin lookup of the EXACT canary account by email (bounded retry). Admin path only. */
export async function findCanaryUserId(admin, email) {
  for (let page = 1; page <= 25; page++) {
    const { data, error, classification } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: 200 }));
    if (error) return { status: classification?.category === 'auth_config' ? 'config_error' : 'failed', scope: 'service_role_key', status_code: classification?.status };
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return { status: 'ok', userId: hit.id };
    if (users.length < 200) break;
  }
  return { status: 'not_found' };
}

/** Recovery: existence-first, then update-only (existing, stale password) or create-only (missing). Canary-only. */
export async function recoverCanaryAccount(admin, { email, password }) {
  const found = await findCanaryUserId(admin, email);
  if (found.status === 'config_error' || found.status === 'failed') return found;
  if (found.status === 'ok') {
    const { error } = await admin.auth.admin.updateUserById(found.userId, { password, email_confirm: true });
    if (error) { const c = classifyError(error); return c.category === 'auth_config' ? { status: 'config_error', scope: 'service_role_key', status_code: c.status } : { status: 'failed', message: 'password sync failed' }; }
    return { status: 'ok', action: 'synced' };
  }
  // not_found → create exactly this canary account
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error && !(error.message || '').includes('already been registered')) {
    const c = classifyError(error);
    return c.category === 'auth_config' ? { status: 'config_error', scope: 'service_role_key', status_code: c.status } : { status: 'failed', message: `createUser failed [${c.category}]` };
  }
  return { status: 'ok', action: 'created' };
}

/** BEST-EFFORT ceiling (used by a SEPARATE hygiene step): 'ok' | 'warn' | 'exceeded' | 'skipped'. */
export async function enforceCeiling(admin, { max = 1, enforce = false, emailRe = CANARY_EMAIL_RE } = {}) {
  const emails = [];
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: 200 }));
    if (error) return { status: 'skipped', reason: classifyError(error).category };
    const users = data?.users || [];
    for (const u of users) if (u.email && emailRe.test(u.email)) emails.push(u.email.toLowerCase());
    if (users.length < 200) break;
  }
  if (emails.length > max) return { status: enforce ? 'exceeded' : 'warn', count: emails.length, max };
  return { status: 'ok', count: emails.length, max };
}

/**
 * Provisioning/HEALTH only (no ceiling — that is a separate hygiene step). RETURNS a result.
 * Statuses: 'healthy' | 'recovered' | 'config_error' | 'tier_error' | 'failed'.
 */
export async function provisionCanary({ anon, admin, config }) {
  const { email, password } = config;

  let signIn = await signInWithBoundedRetry(anon, { email, password });
  let recovered = false;

  if (!signIn.ok) {
    const sc = signIn.classification;
    // Auth/config (anon key, 401/403, invalid-JWT) → STOP, never mutate an account.
    if (sc.category === 'auth_config') return { status: 'config_error', scope: 'anon_auth', status_code: sc.status, message: 'Anon sign-in rejected on auth/config (verify anon key / canary creds). No account mutation attempted.' };
    // Transient exhausted after bounded retry → fail WITHOUT mutation.
    if (sc.category === 'retryable') return { status: 'failed', scope: 'transient', status_code: sc.status, message: 'Anon sign-in failed after bounded retry (transient). No account mutation attempted.' };
    // FAIL CLOSED: only an EXPLICITLY recognized invalid-credentials/account-unavailable response may
    // authorize recovery. Any unknown 4xx, malformed/empty error, or unclassified non-retryable failure
    // ('other') stops here with NO createUser/updateUserById.
    if (sc.category !== 'recoverable_credentials') return { status: 'failed', scope: 'unclassified', status_code: sc.status, message: 'Anon sign-in failed with an unrecognized non-retryable error; NOT eligible for recovery (fail-closed). No account mutation attempted.' };
    // Recognized invalid-credentials / account-unavailable → existence-first, canary-only recovery (admin).
    if (!admin) return { status: 'config_error', scope: 'no_admin_for_recovery', message: 'Sign-in failed (recognized invalid credentials) and no service-role client available for recovery.' };
    const rec = await recoverCanaryAccount(admin, { email, password });
    if (rec.status !== 'ok') return rec;
    signIn = await signInWithBoundedRetry(anon, { email, password });
    if (!signIn.ok) return { status: 'failed', message: 'Recovery completed but a follow-up sign-in still failed.' };
    recovered = true;
  }

  const tier = await verifyTier(anon, signIn.userId);
  if (!tier.ok) return { status: 'tier_error', tier: tier.tier, message: tier.reason };

  return { status: recovered ? 'recovered' : 'healthy', userId: signIn.userId, tier: tier.tier };
}
