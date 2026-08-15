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
 *  - Local profile-binding verification FAILS CLOSED: a query error, missing profile, non-Pro status,
 *    or blank billing identity is NOT healthy. This row is not authoritative Stripe proof; coordinated
 *    cutover requires separate read-only Stripe verification before the first green production run.
 *    Provisioning never writes profile, trial, subscription, or Stripe state; those remain separately
 *    authorized production operations.
 * No credentials, tokens, JWT claims, or user records are returned/logged.
 */

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

const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Verify the signed-in canary's local profile binding. This is intentionally read-only and deliberately
 * does not claim the referenced Stripe objects exist or are current. CI must never reset/extend a
 * customer-style trial, forge a profile entitlement, or manufacture Stripe identity.
 */
export async function verifyCanaryProfileBinding(anon, userId, lane = 'paid-continuation') {
  const { data, error } = await anon
    .from('user_profiles')
    .select('subscription_status,subscription_id,stripe_customer_id,stripe_subscription_id,commercial_trial_granted_at,trial_started_at,trial_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) return { ok: false, tier: null, reason: `profile query error [${classifyError(error).category}]` };
  if (!data) return { ok: false, tier: null, reason: 'profile missing' };
  const tier = data.subscription_status ?? null;

  // Reject any synthetic subscription identity outright (both lanes).
  if (typeof data.stripe_subscription_id === 'string' && data.stripe_subscription_id.startsWith('sub_test_')) {
    return { ok: false, tier, reason: 'synthetic subscription identity' };
  }

  // Server-authoritative effective tier (SECDEF effective_subscription_tier uses now() — NOT the runner clock).
  // #1294: call the CANONICAL 5-arg overload by passing the immutable commercial grant marker. The legacy
  // 4-arg overload fails closed for trials ("cannot carry the immutable commercial grant marker"), so an
  // active-trial canary would falsely read non-'pro'. The 5-arg overload resolves trial = 'pro' when both the
  // marker and an unexpired window exist.
  const { data: effTier, error: tierErr } = await anon.rpc('effective_subscription_tier', {
    p_subscription_status: data.subscription_status,
    p_trial_expires_at: data.trial_expires_at,
    p_stripe_subscription_id: data.stripe_subscription_id,
    p_subscription_id: data.subscription_id,
    p_commercial_trial_granted_at: data.commercial_trial_granted_at,
  });
  if (tierErr) return { ok: false, tier, reason: `tier rpc error [${classifyError(tierErr).category}]` };

  if (lane === 'active-trial') {
    if (!nonBlank(data.commercial_trial_granted_at)) return { ok: false, tier, reason: 'trial missing immutable commercial marker' };
    if (!nonBlank(data.trial_started_at) || !nonBlank(data.trial_expires_at)) return { ok: false, tier, reason: 'trial missing start/expiry' };
    const start = Date.parse(data.trial_started_at), expiry = Date.parse(data.trial_expires_at), marker = Date.parse(data.commercial_trial_granted_at);
    if (![start, expiry, marker].every(Number.isFinite)) return { ok: false, tier, reason: 'trial timestamps unparseable' };
    if (expiry <= start) return { ok: false, tier, reason: 'trial window inverted' };
    // EXACTLY 30*24h (UTC) — allow only a few seconds of serialization noise, never hours (rejects 29d23h/30d1h).
    if (Math.abs((expiry - start) - 30 * 86400_000) > 5000) return { ok: false, tier, reason: 'trial window is not exactly the 30-day foundation' };
    if (Math.abs(marker - start) > 3600_000) return { ok: false, tier, reason: 'trial marker/start inconsistent' };
    if (String(tier).toLowerCase() === 'pro') return { ok: false, tier, reason: 'trial stored state is paid' };
    if (nonBlank(data.stripe_customer_id) || nonBlank(data.stripe_subscription_id)) return { ok: false, tier, reason: 'trial canary has billing identity' };
    if (effTier !== 'pro') return { ok: false, tier, reason: 'trial not active at server time' };
    return { ok: true, tier, localProfileBound: true, lane };
  }
  if (lane !== 'paid-continuation') return { ok: false, tier, reason: 'unknown canary access lane' };
  // Paid: server-authoritative effective pro + genuine (non-synthetic) customer+subscription binding. The
  // exact-$10 Stripe readback remains the separately-authorized Phase B authority.
  if (effTier !== 'pro') return { ok: false, tier, reason: `not effective pro at server time (effective='${effTier}')` };
  if (String(tier).toLowerCase() !== 'pro') return { ok: false, tier, reason: `unexpected stored tier '${tier}' (expected paid pro)` };
  if (!nonBlank(data.stripe_customer_id) || !nonBlank(data.stripe_subscription_id)) {
    return { ok: false, tier, reason: 'paid canary missing customer/subscription identifiers' };
  }
  return { ok: true, tier, localProfileBound: true, lane };
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

// NOTE: the previous canary "recovery" path (admin createUser / updateUserById password sync) was REMOVED
// for #1294 — the canary is strictly read-only. Account creation/reuse is the separately-authorized
// Admin - Test Users operation (scripts/lib/canaryAccountAdmin.mjs). No mutation code exists in this path.

// Domain-independent canary COHORT: any account whose local-part contains the token "canary" (delimited),
// so a retired/stray canary that is NOT one of the configured allowed identities is still counted.
const CANARY_COHORT_LOCAL = /(^|[^a-z0-9])canary([^a-z0-9]|$)/i;

/**
 * BEST-EFFORT canary cohort ceiling (SEPARATE read-only hygiene step): 'ok' | 'warn' | 'exceeded' |
 * 'skipped'. Counts the AUTHORITATIVE canary cohort = the configured allowed identities UNION every account
 * whose local-part matches the canary token — so two configured identities plus one stray/retired canary
 * account exceeds `max`. This DETECTS strays; it never deletes (disposition is a separate authorized op).
 */
export async function enforceCeiling(admin, { max = 1, enforce = false, allowedEmails = [], cohortMatch = CANARY_COHORT_LOCAL } = {}) {
  const identities = new Set(allowedEmails.map((email) => email?.trim().toLowerCase()).filter(Boolean));
  if (identities.size === 0) return { status: 'skipped', reason: 'configured_canary_identities_missing' };
  if (identities.size > max) return { status: enforce ? 'exceeded' : 'warn', count: identities.size, max, reason: 'more_configured_identities_than_max' };
  const cohort = new Set();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await withRetry(() => admin.auth.admin.listUsers({ page, perPage: 200 }));
    if (error) return { status: 'skipped', reason: classifyError(error).category };
    const users = data?.users || [];
    for (const u of users) {
      const email = (u.email || '').toLowerCase();
      if (!email) continue;
      // A configured allowed identity OR any canary-token account (a stray/retired canary not in the set).
      if (identities.has(email) || cohortMatch.test(email.split('@')[0] || '')) cohort.add(email);
    }
    if (users.length < 200) break;
  }
  if (cohort.size > max) return { status: enforce ? 'exceeded' : 'warn', count: cohort.size, max };
  return { status: 'ok', count: cohort.size, max };
}

/**
 * Canary HEALTH — strictly READ-ONLY. Authenticates via the public anon flow and verifies server-
 * authoritative profile binding. ANY sign-in failure FAILS CLOSED: the canary never creates an account,
 * resets a password, or grants/extends/repairs a trial or entitlement — there is no recovery path and no
 * service-role client. RETURNS a result. Statuses: 'healthy' | 'entitlement_error' | 'failed'.
 * (Account ceiling is a separate hygiene step; account creation is a separate Admin operation.)
 */
export async function provisionCanary({ anon, config }) {
  const { email, password, lane = 'paid-continuation' } = config;

  const signIn = await signInWithBoundedRetry(anon, { email, password });
  if (!signIn.ok) {
    const sc = signIn.classification || {};
    // Fail closed on EVERY sign-in failure (auth/config, transient-exhausted, invalid-credentials, or
    // unclassified). No account is created, no password reset, no trial changed.
    return {
      status: 'failed',
      scope: sc.category || 'sign_in',
      status_code: sc.status,
      message: 'Canary sign-in failed; the read-only canary never recovers or mutates an account.',
    };
  }

  const tier = await verifyCanaryProfileBinding(anon, signIn.userId, lane);
  if (!tier.ok) return { status: 'entitlement_error', tier: tier.tier, message: tier.reason };

  return { status: 'healthy', userId: signIn.userId, tier: tier.tier, lane, localProfileBound: true };
}
