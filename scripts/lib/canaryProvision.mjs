/**
 * Canary provisioning core — SIGN-IN-FIRST, testable, content-free.
 *
 * Healthy path uses ONLY the public anon flow (sign in as the stable canary account + read its own
 * RLS-scoped profile). It touches NO admin/service-role API, so a rotated/stale service-role key
 * cannot fail the canary when the account is healthy. Service-role admin is a RECOVERY path only,
 * used when sign-in proves the account is genuinely missing/invalid — and an auth/config failure
 * there (invalid JWT / 401 / 403) is classified as an immediate, non-retryable "rotate the key"
 * error rather than retried or hidden. No credentials, tokens, or user records are ever logged.
 */

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

/** Healthy path: sign in via the anon flow and read the account's own profile tier. No admin key. */
export async function resolveViaSignIn(anon, { email, password }) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error, classification: classifyError(error) };
  const userId = data?.user?.id;
  if (!userId) return { ok: false, error: new Error('no user in session'), classification: { category: 'other', retryable: false } };
  let tier = null;
  try {
    const { data: prof } = await anon.from('user_profiles').select('subscription_status').eq('id', userId).maybeSingle();
    tier = prof?.subscription_status ?? null;
  } catch { /* profile read is best-effort; sign-in success is the health signal */ }
  return { ok: true, userId, tier };
}

/**
 * Orchestrate provisioning and RETURN a result (never process.exit — the caller maps it to exit codes,
 * which keeps this unit-testable). Statuses: 'healthy' | 'recovered' | 'config_error' | 'failed'.
 */
export async function provisionCanary({ anon, admin, config }) {
  const signIn = await resolveViaSignIn(anon, config);
  if (signIn.ok) return { status: 'healthy', userId: signIn.userId, tier: signIn.tier };

  const sc = signIn.classification || classifyError(signIn.error);
  if (sc.category === 'auth_config') {
    // A 401/invalid-JWT on the ANON sign-in points at the canary credentials, not the service-role key.
    return { status: 'config_error', scope: 'canary_credentials', status_code: sc.status, message: 'Canary sign-in rejected (auth) — verify CANARY_EMAIL / CANARY_PASSWORD.' };
  }

  // Recovery requires the service-role key; only reached if sign-in failed for a non-auth reason.
  if (!admin) return { status: 'failed', message: 'Sign-in failed and no service-role client available for recovery.', status_code: sc.status };

  const { error: createErr } = await admin.auth.admin.createUser({ email: config.email, password: config.password, email_confirm: true });
  if (createErr && !(createErr.message || '').includes('already been registered')) {
    const cc = classifyError(createErr);
    if (cc.category === 'auth_config') {
      return { status: 'config_error', scope: 'service_role_key', status_code: cc.status, message: 'SUPABASE_SERVICE_ROLE_KEY invalid/stale for this project (JWT rejected) — rotate the GitHub secret to the current key.' };
    }
    return { status: 'failed', message: `admin createUser failed [${cc.category}${cc.status ? ' ' + cc.status : ''}]`, status_code: cc.status };
  }

  const retry = await resolveViaSignIn(anon, config);
  if (retry.ok) return { status: 'recovered', userId: retry.userId };
  return { status: 'failed', message: 'Recovery ensured the account but a follow-up sign-in still failed.' };
}
