/**
 * Admin - Test Users — canary credential creation core (#1294). Testable, injectable, FAIL-CLOSED.
 *
 * Test User Admin is the single account credential creator. For a canary purpose it resolves the selected
 * email/password pair ONLY from runtime GitHub Secrets (never a dispatch input), then:
 *  - CREATE exactly one email-confirmed identity when DEFINITIVELY absent, writing NO tier, sub_test_
 *    synthetic id, trial, or paid state — it relies on the accepted new-account DB foundation and reads it
 *    back. It then AUTHENTICATES with the supplied password and binds the authenticated id to the created id;
 *  - safely REUSE an existing identity after AUTHENTICATING and proving the authenticated id equals the exact
 *    looked-up id — never duplicating, never silently resetting a password;
 *  - otherwise BLOCK (missing/malformed/equal/prohibited identity, wrong password, duplicate/ambiguous email,
 *    truncated/incomplete inventory scan, id mismatch, unsafe/ambiguous foundation state).
 *
 * Returns { result: 'CREATED' | 'REUSED' | 'BLOCKED', purpose, maskedEmail, facts } — no process.exit, no
 * secret in the return. Callers map BLOCKED to a non-zero exit. Authentication uses the PUBLIC anon flow
 * only (the caller passes an anon client); a service-role key is NOT an acceptable customer-auth fallback.
 */
import { signInWithBoundedRetry, withRetry, classifyError } from './canaryProvision.mjs';

// Secret-backed create purposes. Each resolves its email/password ONLY from the named runtime GitHub
// Secrets (never a dispatch input). `verify` selects the foundation lifecycle proof: a `trial` purpose
// must read back an active immutable 30-day trial; a `paid` purpose establishes credentials only.
//   canary_trial / canary_paid — the production canary identities;
//   free_test — a genuine standard Free account (an active 30-day trial), distinct from both canaries.
export const PURPOSES = {
    canary_trial: { emailVar: 'CANARY_TRIAL_EMAIL', passwordVar: 'CANARY_TRIAL_PASSWORD', verify: 'trial' },
    canary_paid: { emailVar: 'CANARY_PAID_EMAIL', passwordVar: 'CANARY_PAID_PASSWORD', verify: 'paid' },
    free_test: { emailVar: 'FREE_TEST_EMAIL', passwordVar: 'FREE_TEST_PASSWORD', verify: 'trial' },
};
// Back-compat alias for the canary-only subset (older imports).
export const CANARY_PURPOSES = PURPOSES;

const TRIAL_WINDOW_DAYS = 30;
const HOUR_MS = 3600_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nonBlankStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isSyntheticSub = (v) => typeof v === 'string' && v.startsWith('sub_test_');
const isProhibitedDomain = (email) => {
    const domain = String(email).split('@')[1] || '';
    return domain === 'speaksharp.app' || domain.endsWith('.speaksharp.app');
};

/**
 * Validate the SELECTED purpose's identity: nonblank, syntactically valid, not the unaffiliated
 * speaksharp.app apex/subdomain, and DISTINCT from every other configured purpose identity present (so a
 * free_test account can never collide with a canary, and the two canaries can never collide).
 */
function validateSelectedIdentity(purpose, secrets) {
    const cfg = PURPOSES[purpose];
    const email = (secrets[cfg.emailVar] || '').trim().toLowerCase();
    if (!email) return { error: `missing_${cfg.emailVar}` };
    if (!EMAIL_RE.test(email)) return { error: `${cfg.emailVar}_not_a_valid_email` };
    if (isProhibitedDomain(email)) return { error: `${cfg.emailVar}_prohibited_domain` };
    for (const [p, ocfg] of Object.entries(PURPOSES)) {
        if (p === purpose) continue;
        const other = (secrets[ocfg.emailVar] || '').trim().toLowerCase();
        if (other && other === email) return { error: `${cfg.emailVar}_not_distinct_from_${ocfg.emailVar}` };
    }
    return { email };
}

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
 * STRICT existence lookup by normalized exact email. Distinguishes:
 *   'found' (exactly one match), 'absent' (inventory FULLY scanned, zero matches),
 *   'ambiguous' (>1 normalized-email match — never safe to create/reuse),
 *   'truncated' (hit the page cap while the final page was still full — inventory NOT fully scanned, so
 *     absence CANNOT be proven → fail closed), or 'error'. A truncated scan must NEVER be treated as absent.
 */
export async function strictLookup(adminClient, email) {
    const target = email.toLowerCase();
    const PER = 200;
    const MAX_PAGES = 100;
    const matches = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const { data, error } = await withRetry(() => adminClient.auth.admin.listUsers({ page, perPage: PER }));
        if (error) return { status: 'error', category: classifyError(error).category };
        const users = data?.users || [];
        for (const u of users) if ((u.email || '').toLowerCase() === target) matches.push(u.id);
        if (users.length < PER) {
            // Definitive end of the inventory.
            if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
            return matches.length === 1 ? { status: 'found', userId: matches[0] } : { status: 'absent' };
        }
    }
    // Reached the page cap with a still-full final page → inventory not fully scanned.
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
    if (matches.length === 1) return { status: 'found', userId: matches[0] };
    return { status: 'truncated' };
}

/**
 * Read back the accepted new-account DB foundation and fail closed on anything ambiguous — proving the
 * identity is safe for its purpose WITHOUT the caller ever writing entitlement. Server time is the SOLE
 * authority for "active" (via effective_subscription_tier, which uses now()); the runner clock is never the
 * authority. `expectedUserId` binds the readback to the authenticated identity.
 */
export async function verifyCanaryFoundation(adminClient, userId, purpose) {
    const verifyMode = PURPOSES[purpose]?.verify ?? 'trial';
    const { data, error } = await adminClient
        .from('user_profiles')
        .select('id, subscription_status, subscription_id, stripe_subscription_id, stripe_customer_id, trial_started_at, trial_expires_at, commercial_trial_granted_at')
        .eq('id', userId)
        .maybeSingle();
    if (error) return { ok: false, reason: `profile_readback_error_[${classifyError(error).category}]` };
    if (!data) return { ok: false, reason: 'profile_missing_after_foundation' };

    if (isSyntheticSub(data.stripe_subscription_id)) return { ok: false, reason: 'synthetic_subscription_present' };

    // Server-authoritative effective tier (uses now() inside the SECDEF function — NOT the runner clock).
    const { data: effTier, error: tierErr } = await adminClient.rpc('effective_subscription_tier', {
        p_subscription_status: data.subscription_status,
        p_trial_expires_at: data.trial_expires_at,
        p_stripe_subscription_id: data.stripe_subscription_id,
        p_subscription_id: data.subscription_id,
    });
    if (tierErr) return { ok: false, reason: `tier_rpc_error_[${classifyError(tierErr).category}]` };

    if (verifyMode === 'trial') {
        // Immutable commercial marker + start + expiry all present and internally consistent.
        if (!nonBlankStr(data.commercial_trial_granted_at)) return { ok: false, reason: 'trial_missing_commercial_marker' };
        if (!nonBlankStr(data.trial_started_at)) return { ok: false, reason: 'trial_missing_start' };
        if (!nonBlankStr(data.trial_expires_at)) return { ok: false, reason: 'trial_missing_expiry' };
        const start = Date.parse(data.trial_started_at);
        const expiry = Date.parse(data.trial_expires_at);
        const marker = Date.parse(data.commercial_trial_granted_at);
        if (!Number.isFinite(start) || !Number.isFinite(expiry) || !Number.isFinite(marker)) {
            return { ok: false, reason: 'trial_timestamps_unparseable' };
        }
        if (expiry <= start) return { ok: false, reason: 'trial_window_inverted' };
        // Exactly the server-authoritative 30-day foundation window (compares two DB timestamps to each
        // other — not to the runner clock). Marker is stamped at start.
        const windowDays = (expiry - start) / 86400_000;
        if (Math.abs(windowDays - TRIAL_WINDOW_DAYS) > 1) return { ok: false, reason: `trial_window_not_${TRIAL_WINDOW_DAYS}d` };
        if (Math.abs(marker - start) > HOUR_MS) return { ok: false, reason: 'trial_marker_start_inconsistent' };
        // Stored state must be UNBILLED / non-paid-shaped (effective 'pro' comes from the live trial only).
        if (String(data.subscription_status).toLowerCase() === 'pro') return { ok: false, reason: 'trial_stored_state_is_paid' };
        if (nonBlankStr(data.stripe_customer_id) || nonBlankStr(data.stripe_subscription_id)) {
            return { ok: false, reason: 'trial_has_billing_identity' };
        }
        // Server time is the authority for "active".
        if (effTier !== 'pro') return { ok: false, reason: 'trial_not_active_server_time' };
        return { ok: true, facts: { trial_active_server_time: true, trial_window_days: TRIAL_WINDOW_DAYS, commercial_marker: true, paid_synthetic: false } };
    }

    // canary_paid — Admin establishes CREDENTIALS ONLY; it writes no entitlement. Reject partial, conflicting,
    // or synthetic billing shapes: the billing identity must be either fully absent (clean credentials-only)
    // or fully genuine (both non-synthetic customer + subscription). A half-set/synthetic shape is unsafe.
    const hasCustomer = nonBlankStr(data.stripe_customer_id);
    const hasSub = nonBlankStr(data.stripe_subscription_id);
    if (hasCustomer !== hasSub) return { ok: false, reason: 'paid_partial_billing_identity' };
    if (hasSub && isSyntheticSub(data.stripe_subscription_id)) return { ok: false, reason: 'synthetic_subscription_present' };
    return { ok: true, facts: { paid_synthetic: false, paid_established_here: false, billing_bound: hasCustomer && hasSub } };
}

/**
 * Authenticate with the supplied password via the PUBLIC anon flow and require the authenticated id to equal
 * the exact expected identity — WITHOUT ever resetting the password. Then verify the foundation. Returns the
 * REUSED/CREATED-shaped foundation result on success or a BLOCKED reason.
 */
async function authenticateAndVerify({ signInClient, adminClient, email, password, purpose, maskedEmail, expectedUserId, resultLabel, extraFacts = {} }) {
    const signIn = await signInWithBoundedRetry(signInClient, { email, password });
    if (!signIn.ok) {
        const category = signIn.classification?.category || 'unknown';
        return blocked(purpose, maskedEmail, `authentication_failed_[${category}]`, { password_reset: false });
    }
    if (signIn.userId !== expectedUserId) {
        return blocked(purpose, maskedEmail, 'authenticated_id_mismatch', { password_reset: false });
    }
    const check = await verifyCanaryFoundation(adminClient, expectedUserId, purpose);
    if (!check.ok) return blocked(purpose, maskedEmail, check.reason, { password_reset: false });
    return { result: resultLabel, purpose, maskedEmail, facts: { ...check.facts, ...extraFacts, password_reset: false } };
}

/**
 * Core canary provisioning. Injectable clients make it fully testable.
 * @param {object}   args
 * @param {object}   args.adminClient       service-role Supabase client (lookup + createUser + profile read + tier RPC)
 * @param {Function} args.makeSignInClient  () => PUBLIC anon Supabase client for read-only password auth
 * @param {object}   args.secrets           runtime secrets for the purpose (CANARY_*_EMAIL/PASSWORD, FREE_TEST_EMAIL/PASSWORD)
 * @param {string}   args.purpose           'canary_trial' | 'canary_paid' | 'free_test'
 */
export async function provisionCanaryCredential({ adminClient, makeSignInClient, secrets = {}, purpose }) {
    const cfg = PURPOSES[purpose];
    if (!cfg) return blocked(purpose, '***', `invalid_purpose_${purpose}`);

    // 1) Validate the SELECTED identity: present, valid, non-prohibited (speaksharp.app apex/subdomain), and
    //    DISTINCT from every other configured purpose identity. Passwords are never logged.
    const idCheck = validateSelectedIdentity(purpose, secrets);
    if (idCheck.error) return blocked(purpose, '***', `identity_invalid: ${idCheck.error}`);

    const email = idCheck.email;
    const password = secrets[cfg.passwordVar] || '';
    const maskedEmail = maskEmail(email);
    if (!nonBlankStr(password)) return blocked(purpose, maskedEmail, `missing_${cfg.passwordVar}`);

    const signInClient = typeof makeSignInClient === 'function' ? makeSignInClient() : null;
    if (!signInClient) return blocked(purpose, maskedEmail, 'no_anon_sign_in_client'); // anon auth is mandatory

    // 2) STRICT existence-first lookup. Ambiguous/truncated/error → fail closed (never a blind create).
    const found = await strictLookup(adminClient, email);
    if (found.status === 'error') return blocked(purpose, maskedEmail, `auth_admin_error_[${found.category}]`);
    if (found.status === 'ambiguous') return blocked(purpose, maskedEmail, 'duplicate_identity');
    if (found.status === 'truncated') return blocked(purpose, maskedEmail, 'inventory_scan_truncated');

    if (found.status === 'absent') {
        // 3a) DEFINITIVELY absent → create exactly one email-confirmed user; write NO tier/sub/trial. Then
        //     authenticate with the supplied password and bind the authenticated id to the created id.
        const { data, error } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
            // A create race means it now exists → re-lookup strictly and verify reuse (never duplicate).
            if ((error.message || '').includes('already been registered')) {
                const re = await strictLookup(adminClient, email);
                if (re.status !== 'found') return blocked(purpose, maskedEmail, `create_race_unresolved_${re.status}`);
                return authenticateAndVerify({ signInClient, adminClient, email, password, purpose, maskedEmail, expectedUserId: re.userId, resultLabel: 'REUSED', extraFacts: { created_race: true } });
            }
            return blocked(purpose, maskedEmail, `create_failed_[${classifyError(error).category}]`);
        }
        const createdId = data?.user?.id;
        if (!nonBlankStr(createdId)) return blocked(purpose, maskedEmail, 'create_returned_no_id');
        return authenticateAndVerify({ signInClient, adminClient, email, password, purpose, maskedEmail, expectedUserId: createdId, resultLabel: 'CREATED' });
    }

    // 3b) Found exactly once → never duplicate, never reset. Authenticate + bind to the exact found id.
    return authenticateAndVerify({ signInClient, adminClient, email, password, purpose, maskedEmail, expectedUserId: found.userId, resultLabel: 'REUSED' });
}
