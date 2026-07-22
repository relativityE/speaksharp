/**
 * Canary provisioning core — SIGN-IN-FIRST, testable, content-free.
 *
 * Root cause of the red canary (proven by a same-key control that PASSED admin.listUsers): the canary
 * front-loaded admin operations (createUser + listUsers) on EVERY run and hit an intermittent invalid-
 * JWT, while the app + the established controls use the normal/anon path that works. The credential is
 * valid — the process was the defect.
 *
 * Design:
 *  - HEALTHY PATH uses ONLY the public anon flow (sign in as the stable canary + read its own RLS-scoped
 *    profile). No admin/service-role call, so intermittent admin failures can't fail a healthy canary.
 *  - ADMIN (service-role) is RECOVERY-ONLY (missing account, or an existing account whose password
 *    drifted → sync it) and a BEST-EFFORT ceiling check. Admin and anon use SEPARATE clients; a user is
 *    never signed into the admin client.
 *  - Error classification: invalid-JWT / 401 / 403 → NON-retryable; retry only network / 429 / 5xx.
 *  - The ceiling check NEVER fails a healthy canary on an admin error (that's the flaky path); it only
 *    hard-fails when it actually observes a real over-ceiling breach.
 * No credentials, tokens, JWT claims, or user records are ever returned/logged.
 */

const CANARY_EMAIL_RE = /^canary(-.+)?@speaksharp\.app$/i;

/** Classify a Supabase error into an actionable, content-free category. */
export function classifyError(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const msg = (error?.message || '').toLowerCase();
  const isAuthConfig =
    status === 401 || status === 403 ||
    msg.includes('invalid jwt') || msg.includes('unrecognized') ||
    msg.includes('unable to parse or verify signature') || msg.includes('token is unverifiable');
  if (isAuthConfig) return { status, category: 'auth_config', retryable: false };
  const isRetryable =
    status === 429 || (typeof status === 'number' && status >= 500) ||
    msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset');
  return { status, category: isRetryable ? 'retryable' : 'other', retryable: isRetryable };
}

/** Retry a {data,error}-returning op ONLY on retryable errors (never 401/403/invalid-JWT). */
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

/** Healthy path: sign in via the anon flow and read the account's own profile tier. No admin key. */
export async function resolveViaSignIn(anon, { email, password }) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error, classification: classifyError(error) };
  const userId = data?.user?.id;
  if (!userId) return { ok: false, error: new Error('no user in session'), classification: { category: 'other', retryable: false } };
  return { ok: true, userId };
}

/** Verify the signed-in canary's own tier (best-effort). Free/new is expected; pro is a red flag. */
export async function verifyTier(anon, userId) {
  try {
    const { data } = await anon.from('user_profiles').select('subscription_status').eq('id', userId).maybeSingle();
    const tier = data?.subscription_status ?? null;
    return { tier, ok: (tier ?? 'free') !== 'pro' };
  } catch {
    return { tier: null, ok: true }; // best-effort — sign-in success is the health signal
  }
}

/** Recovery: paginated admin lookup of a user id by email (bounded retry). Admin path only. */
async function findUserId(admin, email) {
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

/** Recovery: ensure the canary account exists AND its password matches (distinguish missing vs stale). */
export async function ensureCanaryAccount(admin, { email, password }) {
  const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!createErr) return { status: 'created' };
  const cc = classifyError(createErr);
  if (cc.category === 'auth_config') return { status: 'config_error', scope: 'service_role_key', status_code: cc.status };
  if ((createErr.message || '').includes('already been registered')) {
    // Account EXISTS but sign-in failed → password/confirmation drift → sync it (do not recreate).
    const found = await findUserId(admin, email);
    if (found.status !== 'ok') return found.status === 'not_found' ? { status: 'failed', message: 'account reported existing but not found' } : found;
    const { error: updErr } = await admin.auth.admin.updateUserById(found.userId, { password, email_confirm: true });
    if (updErr) {
      const uc = classifyError(updErr);
      return uc.category === 'auth_config' ? { status: 'config_error', scope: 'service_role_key', status_code: uc.status } : { status: 'failed', message: 'password sync failed' };
    }
    return { status: 'synced' };
  }
  return { status: 'failed', message: `createUser failed [${cc.category}${cc.status ? ' ' + cc.status : ''}]` };
}

/** BEST-EFFORT ceiling: skip (never fail) on an admin error; hard-fail only on a real over-ceiling breach. */
export async function enforceCeiling(admin, { max = 1, enforce = false, emailRe = CANARY_EMAIL_RE } = {}) {
  const emails = [];
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: 200 }));
    if (error) return { status: 'skipped' }; // admin flakiness must not fail a healthy canary
    const users = data?.users || [];
    for (const u of users) if (u.email && emailRe.test(u.email)) emails.push(u.email.toLowerCase());
    if (users.length < 200) break;
  }
  if (emails.length > max) return { status: enforce ? 'exceeded' : 'warn', count: emails.length, max };
  return { status: 'ok', count: emails.length, max };
}

/**
 * Orchestrate provisioning and RETURN a result (never process.exit — the caller maps exit codes).
 * Statuses: 'healthy' | 'recovered' | 'config_error' | 'ceiling_exceeded' | 'failed'.
 */
export async function provisionCanary({ anon, admin, config }) {
  const { email, password, ceilingMax = 1, ceilingEnforce = false } = config;

  let signIn = await resolveViaSignIn(anon, { email, password });
  let recovered = false;

  if (!signIn.ok) {
    // Sign-in failed — do NOT assume the account is missing. Recover via admin (create OR sync password).
    if (!admin) return { status: 'config_error', scope: 'no_admin_for_recovery', message: 'Sign-in failed and no service-role client available for recovery.' };
    const rec = await ensureCanaryAccount(admin, { email, password });
    if (rec.status === 'config_error') return rec; // admin invalid-JWT/401 → actionable, not retried
    if (rec.status === 'failed') return { status: 'failed', message: rec.message };
    signIn = await resolveViaSignIn(anon, { email, password });
    if (!signIn.ok) return { status: 'failed', message: 'Recovery ensured the account but a follow-up sign-in still failed.' };
    recovered = true;
  }

  const tier = await verifyTier(anon, signIn.userId);
  // Best-effort ceiling on the admin client (separate from the anon sign-in client above).
  const ceiling = admin ? await enforceCeiling(admin, { max: ceilingMax, enforce: ceilingEnforce }) : { status: 'skipped' };
  if (ceiling.status === 'exceeded') return { status: 'ceiling_exceeded', count: ceiling.count, max: ceiling.max };

  return { status: recovered ? 'recovered' : 'healthy', userId: signIn.userId, tier: tier.tier, ceiling: ceiling.status, ceilingCount: ceiling.count };
}
