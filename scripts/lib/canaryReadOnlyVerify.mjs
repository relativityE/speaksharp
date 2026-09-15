/**
 * Canary identity inspection — STRICTLY READ-ONLY (Product Owner decision, 15 Sep 2026; canary record on PR #1399).
 *
 * Answers "is each configured canary identity in a state the Production canary could run on?" without touching
 * Production state. It never authenticates as the canary (so no token is issued and `last_sign_in_at` is never
 * stamped), never creates, updates or deletes anything, and never reads row contents. Credential viability is
 * therefore NOT tested here; it is proven only by the later, separately authorized canary rerun.
 *
 * Reads, all with the service-role admin client:
 *   - exact identity lookup (`strictLookup`: one / none / duplicate / truncated scan);
 *   - the auth record's creation time and PRIOR last sign-in time (`getUserById`);
 *   - the profile's entitlement shape and trial timestamps, and the server-time effective tier
 *     (`effective_subscription_tier`, canonical 5-argument overload, the only RPC used);
 *   - row COUNTS of every table that references the user (`head: true`), for retirement preflight.
 *
 * Output is masked and content-free: masked identity, a short content-safe digest, minute-rounded timestamps,
 * enums and counts. No email, token, Stripe identifier or row content is ever emitted.
 */
import { hash } from 'node:crypto';
import { maskEmail, strictLookup, verifyCanaryFoundation } from './canaryAccountAdmin.mjs';

export const CANARY_TARGETS = Object.freeze([
    Object.freeze({ purpose: 'canary_trial', label: 'trial canary', emailVar: 'CANARY_TRIAL_EMAIL' }),
    Object.freeze({ purpose: 'canary_paid', label: 'paid canary', emailVar: 'CANARY_PAID_EMAIL' }),
]);

export const VERDICTS = Object.freeze({
    ELIGIBLE: 'ELIGIBLE_CREDENTIAL_PENDING',
    INELIGIBLE: 'INELIGIBLE',
    AMBIGUOUS: 'AMBIGUOUS_UNSAFE_TO_MUTATE',
});

// Closure wording required by the Product Owner, one per verdict.
export const VERDICT_STATEMENTS = Object.freeze({
    [VERDICTS.ELIGIBLE]: 'account state appears eligible; credential viability pending authorized canary',
    [VERDICTS.INELIGIBLE]: 'account state is ineligible',
    [VERDICTS.AMBIGUOUS]: 'identity state is ambiguous or unsafe to mutate',
});

/**
 * Every table that references the user, with its ON DELETE rule, from the repository schema at main@734d045a
 * (renames applied: custom_vocabulary → user_filler_words, guided_* → objective_*). CASCADE rows go with the
 * account; SET NULL rows survive as residue; a RESTRICT/NO ACTION row would block retirement.
 */
export const DEPENDENTS = Object.freeze([
    ['active_recording_lease', 'user_id', 'CASCADE'],
    ['ai_suggestion_authority_receipts', 'user_id', 'CASCADE'],
    ['ai_suggestion_usage_daily', 'user_id', 'CASCADE'],
    ['formatter_usage_daily', 'user_id', 'CASCADE'],
    ['objective_account_capability', 'user_id', 'CASCADE'],
    ['objective_action', 'user_id', 'CASCADE'],
    ['objective_action_dispute', 'user_id', 'CASCADE'],
    ['objective_brief', 'user_id', 'CASCADE'],
    ['objective_brief_point', 'user_id', 'CASCADE'],
    ['objective_evidence', 'user_id', 'CASCADE'],
    ['objective_project', 'user_id', 'CASCADE'],
    ['objective_session', 'user_id', 'CASCADE'],
    ['objective_source_recording', 'user_id', 'CASCADE'],
    ['progress_recommendation_attempts', 'user_id', 'CASCADE'],
    ['progress_recommendations', 'user_id', 'CASCADE'],
    ['session_attribution_authority', 'user_id', 'CASCADE'],
    ['session_attribution_challenge', 'user_id', 'CASCADE'],
    ['session_attribution_unattributed', 'user_id', 'CASCADE'],
    ['session_progress_evaluations', 'user_id', 'CASCADE'],
    ['sessions', 'user_id', 'CASCADE'],
    ['transcript_retention_arming', 'user_id', 'CASCADE'],
    ['transcript_retention_tombstones', 'user_id', 'CASCADE'],
    ['usage_checkpoints', 'user_id', 'CASCADE'],
    ['user_filler_words', 'user_id', 'CASCADE'],
    ['user_goals', 'user_id', 'CASCADE'],
    ['trial_entitlements', 'user_id', 'SET NULL'],
    ['user_issue_reports', 'user_id', 'SET NULL'],
].map((row) => Object.freeze(row)));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nonBlank = (v) => typeof v === 'string' && v.trim().length > 0;
const DAY_MS = 86400_000;

/** Stable, content-safe correlation digest for one identity. Not reversible to the address in any useful sense. */
export function identityDigest(email) {
    // One-shot `hash` (Node ≥ 21.7) rather than a chained hasher, so the no-write contract scan stays literal.
    return hash('sha256', `speaksharp-canary-v1:${String(email).trim().toLowerCase()}`, 'hex').slice(0, 12);
}

/** Minute-rounded ISO UTC, `null` when absent, `'unparseable'` when not a timestamp. */
export function roundToMinute(value) {
    if (!nonBlank(value)) return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return 'unparseable';
    const d = new Date(ms);
    d.setUTCSeconds(0, 0);
    return d.toISOString();
}

function billingShape(profile) {
    const customer = nonBlank(profile.stripe_customer_id);
    const subscription = nonBlank(profile.stripe_subscription_id);
    if (customer && subscription) return 'complete';
    if (!customer && !subscription) return 'none';
    return 'partial';
}

const withVerdict = (report, verdict, reason = null) => ({
    ...report,
    verdict,
    reason,
    statement: reason ? `${VERDICT_STATEMENTS[verdict]}: ${reason}` : VERDICT_STATEMENTS[verdict],
});

async function countDependents(adminClient, userId) {
    const counts = {};
    for (const [table, column] of DEPENDENTS) {
        const { count, error } = await adminClient.from(table).select('*', { count: 'exact', head: true }).eq(column, userId);
        counts[table] = error || typeof count !== 'number' ? 'unreadable' : count;
    }
    return counts;
}

function retirementPreflight(counts) {
    let residue = false;
    for (const [table, , rule] of DEPENDENTS) {
        const n = counts[table];
        if (n === 'unreadable') return 'UNKNOWN';
        if (n > 0 && rule !== 'CASCADE' && rule !== 'SET NULL') return 'BLOCKED';
        if (n > 0 && rule === 'SET NULL') residue = true;
    }
    return residue ? 'RESIDUE_ONLY' : 'CLEAN';
}

/**
 * Inspect ONE configured canary identity. Pure function of the injected admin client; returns a masked report
 * whose `verdict` is exactly one of VERDICTS.
 */
export async function inspectCanaryIdentity({ adminClient, email, purpose, label }) {
    const configured = nonBlank(email) && EMAIL_RE.test(email.trim());
    const base = {
        label,
        purpose,
        maskedIdentity: configured ? maskEmail(email.trim()) : '***',
        digest: configured ? identityDigest(email) : null,
    };
    if (!CANARY_TARGETS.some((t) => t.purpose === purpose)) return withVerdict(base, VERDICTS.AMBIGUOUS, 'invalid_purpose');
    if (!configured) return withVerdict({ ...base, identityCount: null }, VERDICTS.INELIGIBLE, 'identity_not_configured');

    const found = await strictLookup(adminClient, email.trim());
    if (found.status === 'absent') return withVerdict({ ...base, identityCount: 0 }, VERDICTS.INELIGIBLE, 'identity_missing');
    if (found.status === 'ambiguous') return withVerdict({ ...base, identityCount: found.count }, VERDICTS.AMBIGUOUS, 'duplicate_identity');
    if (found.status === 'truncated') return withVerdict({ ...base, identityCount: null }, VERDICTS.AMBIGUOUS, 'inventory_scan_truncated');
    if (found.status !== 'found') return withVerdict({ ...base, identityCount: null }, VERDICTS.AMBIGUOUS, `auth_admin_error_[${found.category ?? 'unknown'}]`);

    const userId = found.userId;
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(userId);
    const authUser = userData?.user;
    if (userError || !authUser) return withVerdict({ ...base, identityCount: 1 }, VERDICTS.AMBIGUOUS, 'auth_record_unreadable');
    if (authUser.id !== userId || String(authUser.email || '').toLowerCase() !== email.trim().toLowerCase()) {
        return withVerdict({ ...base, identityCount: 1 }, VERDICTS.AMBIGUOUS, 'auth_record_mismatch');
    }

    const report = {
        ...base,
        identityCount: 1,
        authCreatedAt: roundToMinute(authUser.created_at),
        priorLastSignInAt: roundToMinute(authUser.last_sign_in_at),
    };

    // ONE read, ONE eligibility authority (Codex P2 4020951921, PM direction 15 Sep). The Admin helper performs
    // the single profile read and the single tier RPC, judges them, and returns the snapshot it validated. This
    // module reads NEITHER: it reports exactly that snapshot, so no second read can pair one read's verdict with
    // another read's reported facts — a mid-flight entitlement change can no longer be reported as eligible.
    const foundation = await verifyCanaryFoundation(adminClient, userId, purpose);
    const profile = foundation.snapshot;
    const dependents = await countDependents(adminClient, userId);
    const withDependents = { ...report, dependentRowCounts: dependents, retirementPreflight: retirementPreflight(dependents) };

    // The helper's read-failure reasons are unreadable state, not a judgment about the identity.
    if (/^profile_readback_error/.test(foundation.reason ?? '')) {
        return withVerdict({ ...withDependents, profilePresent: null }, VERDICTS.AMBIGUOUS, 'profile_unreadable');
    }
    if (foundation.reason === 'profile_missing_after_foundation' || !profile) {
        return withVerdict({ ...withDependents, profilePresent: false }, VERDICTS.INELIGIBLE, 'profile_missing');
    }

    const start = Date.parse(profile.trial_started_at);
    const expiry = Date.parse(profile.trial_expires_at);
    const tierUnreadable = /^tier_rpc_error/.test(foundation.reason ?? '');
    const shaped = {
        ...withDependents,
        profilePresent: true,
        storedTier: nonBlank(profile.subscription_status) ? profile.subscription_status.trim().toLowerCase() : null,
        effectiveTier: tierUnreadable ? 'unreadable' : foundation.effectiveTier ?? null,
        billingIdentityShape: billingShape(profile),
        trialStartedAt: roundToMinute(profile.trial_started_at),
        trialExpiresAt: roundToMinute(profile.trial_expires_at),
        commercialTrialGrantedAt: roundToMinute(profile.commercial_trial_granted_at),
        trialWindowDays: Number.isFinite(start) && Number.isFinite(expiry) ? Math.round(((expiry - start) / DAY_MS) * 100) / 100 : null,
    };
    if (tierUnreadable) return withVerdict(shaped, VERDICTS.AMBIGUOUS, 'effective_tier_unreadable');

    // Every unreadable-read case returned above, so any remaining !ok is a judgment about the identity's actual
    // state — reported as INELIGIBLE with the helper's own sanitized reason.
    if (!foundation.ok) return withVerdict(shaped, VERDICTS.INELIGIBLE, foundation.reason);
    if (purpose === 'canary_paid') {
        // The shared paid lane deliberately accepts a clean credentials-only account (Admin writes no
        // entitlement). The canary additionally needs a genuine, server-effective paid Pro binding to run.
        if (shaped.effectiveTier !== 'pro') return withVerdict(shaped, VERDICTS.INELIGIBLE, 'paid_not_effective_pro');
        if (shaped.storedTier !== 'pro') return withVerdict(shaped, VERDICTS.INELIGIBLE, 'paid_stored_tier_not_pro');
        if (shaped.billingIdentityShape !== 'complete') return withVerdict(shaped, VERDICTS.INELIGIBLE, 'paid_billing_identity_incomplete');
    }
    return withVerdict(shaped, VERDICTS.ELIGIBLE);
}

/** Fail closed if a report could leak an identity, token or billing identifier. Throws; never prints. */
export function assertRedacted(report, emails = []) {
    const { maskedIdentity, ...rest } = report;
    const text = JSON.stringify(rest);
    const leaks = [];
    for (const email of emails) if (nonBlank(email) && JSON.stringify(report).toLowerCase().includes(email.trim().toLowerCase())) leaks.push('email');
    if (text.includes('@')) leaks.push('address_character');
    if (/\b(?:sub|cus)_[A-Za-z0-9]/.test(text)) leaks.push('billing_identifier');
    if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) leaks.push('token_like');
    if (maskedIdentity !== '***' && !/^.\*\*\*@.\*\*\*(\.[A-Za-z0-9]+)?$/.test(String(maskedIdentity))) leaks.push('mask_shape');
    if (leaks.length > 0) throw new Error(`redaction_violation:${[...new Set(leaks)].join(',')}`);
    return true;
}

/** Inspect both configured canary identities from the environment. */
export async function runCanaryInspection({ adminClient, env }) {
    const results = [];
    const emails = CANARY_TARGETS.map((t) => env[t.emailVar]);
    for (const target of CANARY_TARGETS) {
        const report = await inspectCanaryIdentity({ adminClient, email: env[target.emailVar], purpose: target.purpose, label: target.label });
        assertRedacted(report, emails);
        results.push(report);
    }
    return { results, allEligible: results.every((r) => r.verdict === VERDICTS.ELIGIBLE) };
}

/** One human-readable, masked line per identity. */
export function formatCanaryLine(report) {
    const id = report.digest ? `${report.maskedIdentity} #${report.digest}` : report.maskedIdentity;
    return `${report.verdict} ${report.label} [${id}]: ${report.statement}`;
}
