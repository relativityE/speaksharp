/**
 * Admin - Test Users — canary credential creation core (#1294). Testable, injectable, FAIL-CLOSED.
 *
 * Test User Admin is the single account credential creator. For a canary purpose it resolves the selected
 * email/password pair ONLY from runtime GitHub Secrets (never a dispatch input), then:
 *  - CREATE exactly one email-confirmed identity when absent, writing NO tier, sub_test_ synthetic id,
 *    trial, or paid state — it relies on the accepted new-account DB foundation and reads it back;
 *  - safely REUSE an existing identity after verifying the SUPPLIED password authenticates (read-only
 *    sign-in) and the profile is safe for the purpose — never duplicating, never silently resetting a
 *    password;
 *  - otherwise BLOCK (missing/malformed/equal/prohibited identity, wrong password, unsafe/ambiguous state).
 *
 * Returns { result: 'CREATED' | 'REUSED' | 'BLOCKED', purpose, maskedEmail, facts } — no process.exit, no
 * secret in the return. Callers map BLOCKED to a non-zero exit.
 */
import { signInWithBoundedRetry, findCanaryUserId, classifyError } from './canaryProvision.mjs';
import { validateCanaryIdentityConfig } from './canaryIdentityConfig.mjs';

export const CANARY_PURPOSES = {
    canary_trial: { emailVar: 'CANARY_TRIAL_EMAIL', passwordVar: 'CANARY_TRIAL_PASSWORD' },
    canary_paid: { emailVar: 'CANARY_PAID_EMAIL', passwordVar: 'CANARY_PAID_PASSWORD' },
};

const nonBlankStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** Mask an email so logs/summaries correlate a run without exposing the identity. Never masks a password. */
export function maskEmail(email) {
    const [local = '', domain = ''] = String(email || '').split('@');
    const head = local.slice(0, 1) || '*';
    const dparts = domain.split('.');
    const tld = dparts.length > 1 ? dparts.pop() : '';
    const dhead = (dparts.join('.') || '').slice(0, 1) || '*';
    return `${head}***@${dhead}***${tld ? '.' + tld : ''}`;
}

const blocked = (purpose, maskedEmail, reason, facts = {}) =>
    ({ result: 'BLOCKED', purpose, maskedEmail, facts: { reason, ...facts } });

/**
 * Read back the accepted new-account DB foundation and fail closed on anything ambiguous — proving the
 * identity is safe for its purpose WITHOUT the caller ever writing entitlement:
 *  - a synthetic sub_test_* is rejected (fabricated paid state);
 *  - canary_trial requires a live server-time trial window and no paid billing identity;
 *  - canary_paid establishes credentials only — a paid subscription is NOT created here (genuine paid
 *    continuation is a separately authorized Stripe operation), so its absence is expected and safe.
 */
export async function verifyCanaryFoundation(adminClient, userId, purpose, now = Date.now()) {
    const { data, error } = await adminClient
        .from('user_profiles')
        .select('id, subscription_status, stripe_subscription_id, stripe_customer_id, trial_started_at, trial_expires_at')
        .eq('id', userId)
        .maybeSingle();
    if (error) return { ok: false, reason: `profile_readback_error_[${classifyError(error).category}]` };
    if (!data) return { ok: false, reason: 'profile_missing_after_foundation' };

    if (typeof data.stripe_subscription_id === 'string' && data.stripe_subscription_id.startsWith('sub_test_')) {
        return { ok: false, reason: 'synthetic_subscription_present' };
    }

    if (purpose === 'canary_trial') {
        const expiresAt = typeof data.trial_expires_at === 'string' ? Date.parse(data.trial_expires_at) : Number.NaN;
        if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'trial_window_missing' };
        if (expiresAt <= now) return { ok: false, reason: 'trial_window_expired' };
        if (nonBlankStr(data.stripe_subscription_id) || nonBlankStr(data.stripe_customer_id)) {
            return { ok: false, reason: 'trial_has_unexpected_billing_identity' };
        }
        return { ok: true, facts: { trial_active: true, trial_synthetic: false, paid_synthetic: false } };
    }
    // canary_paid — credentials only; no paid state is established here.
    return { ok: true, facts: { paid_synthetic: false, paid_established_here: false } };
}

/**
 * Verify a supplied canary credential authenticates (read-only sign-in via the anon flow) and its profile
 * is safe for the purpose — WITHOUT ever resetting the password. Returns REUSED or BLOCKED.
 */
async function verifyReuse({ adminClient, makeSignInClient, email, password, purpose, maskedEmail, now, extraFacts = {} }) {
    const signInClient = makeSignInClient();
    const signIn = await signInWithBoundedRetry(signInClient, { email, password });
    if (!signIn.ok) {
        const category = signIn.classification?.category || 'unknown';
        // Wrong / invalid credentials or any non-authenticating result: BLOCKED. The password is NOT reset —
        // rotation remains a separate, explicitly authorized operation.
        return blocked(purpose, maskedEmail, `authentication_failed_[${category}]`, { password_reset: false });
    }
    const check = await verifyCanaryFoundation(adminClient, signIn.userId, purpose, now);
    if (!check.ok) return blocked(purpose, maskedEmail, check.reason, { password_reset: false });
    return { result: 'REUSED', purpose, maskedEmail, facts: { ...check.facts, ...extraFacts, password_reset: false } };
}

/**
 * Core canary provisioning. Injectable clients make it fully testable.
 * @param {object}   args
 * @param {object}   args.adminClient       service-role Supabase client (lookup + createUser + profile read)
 * @param {Function} args.makeSignInClient  () => anon Supabase client used ONLY for read-only password check
 * @param {object}   args.secrets           { CANARY_TRIAL_EMAIL, CANARY_TRIAL_PASSWORD, CANARY_PAID_EMAIL, CANARY_PAID_PASSWORD }
 * @param {string}   args.purpose           'canary_trial' | 'canary_paid'
 * @param {number}   [args.now]             injectable clock (ms) for deterministic trial-window tests
 */
export async function provisionCanaryCredential({ adminClient, makeSignInClient, secrets = {}, purpose, now = Date.now() }) {
    const cfg = CANARY_PURPOSES[purpose];
    if (!cfg) return blocked(purpose, '***', `invalid_purpose_${purpose}`);

    // 1) Validate the full canary identity config: both emails present, distinct, and not the unaffiliated
    //    speaksharp.app apex/subdomain. Throws on any violation → BLOCKED. Passwords are never logged.
    try {
        validateCanaryIdentityConfig({ trialEmail: secrets.CANARY_TRIAL_EMAIL, paidEmail: secrets.CANARY_PAID_EMAIL });
    } catch (e) {
        return blocked(purpose, '***', `identity_config_invalid: ${e.message}`);
    }

    const email = (secrets[cfg.emailVar] || '').trim().toLowerCase();
    const password = secrets[cfg.passwordVar] || '';
    const maskedEmail = maskEmail(email);

    if (!nonBlankStr(email)) return blocked(purpose, '***', `missing_${cfg.emailVar}`);
    if (!nonBlankStr(password)) return blocked(purpose, maskedEmail, `missing_${cfg.passwordVar}`);

    // 2) Existence-first admin lookup by normalized exact email (never a createUser conflict as the test).
    const found = await findCanaryUserId(adminClient, email);
    if (found.status === 'config_error' || found.status === 'failed') {
        return blocked(purpose, maskedEmail, `auth_admin_${found.status}`);
    }

    if (found.status === 'not_found') {
        // 3a) Absent → create exactly one email-confirmed user; write NO tier/sub/trial. Read back the
        //     foundation-created profile and fail closed if it is missing/ambiguous.
        const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
            if ((error.message || '').includes('already been registered')) {
                return verifyReuse({ adminClient, makeSignInClient, email, password, purpose, maskedEmail, now, extraFacts: { created_race: true } });
            }
            return blocked(purpose, maskedEmail, `create_failed_[${classifyError(error).category}]`);
        }
        const check = await verifyCanaryFoundation(adminClient, data?.user?.id, purpose, now);
        if (!check.ok) return blocked(purpose, maskedEmail, check.reason);
        return { result: 'CREATED', purpose, maskedEmail, facts: check.facts };
    }

    // 3b) Present → never duplicate, never silently reset. Verify supplied creds authenticate + profile safe.
    return verifyReuse({ adminClient, makeSignInClient, email, password, purpose, maskedEmail, now });
}
