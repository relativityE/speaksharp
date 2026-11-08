/**
 * Browser-endurance account readiness — READ-ONLY, injectable, FAIL-CLOSED (Stress and Endurance run 42474354454; Sam 1794138777,
 * 1794138818).
 *
 * The dedicated endurance accounts must already be genuine active-trial accounts by the SERVER's definition before the soak setup
 * performs ANY write (rename, password synchronization, provisioning, tier synchronization). Recreating an account cannot restore a
 * trial: `public.ensure_trial_profile_for_new_user` (migration 20261013180000) keys `public.trial_entitlements` by e-mail and copies
 * the historical trial dates onto a recreated profile, so an expired e-mail stays expired (run 42474354454 deleted and recreated
 * soak-test45/46 and both came back with their 2026-05-30 expiry). This module therefore only READS:
 *   - the Auth inventory (exactly one owner per address),
 *   - that owner's `user_profiles` trial fields (the commercial grant marker AND an unexpired `trial_expires_at`),
 *   - the e-mail's `trial_entitlements` row (bound to that owner, the same expiry).
 * Each account is `active`, `expired`, `missing`, `ambiguous` or `unreadable`; `ready` only when every account is `active`.
 * It never creates, deletes, renames, resets a password, stamps or extends a trial. Callers refuse (non-zero exit) when not ready.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

const normalize = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

function instant(value) {
    if (value === null || value === undefined) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : NaN;
}

async function authInventory(adminClient) {
    const users = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        let res;
        try {
            res = await adminClient.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        } catch {
            return null;
        }
        if (!res || res.error || !Array.isArray(res.data?.users)) return null;
        users.push(...res.data.users);
        if (res.data.users.length < PAGE_SIZE) return users;
    }
    return null; // a truncated inventory is unreadable, never "missing"
}

async function readOne(adminClient, table, columns, column, value) {
    try {
        const res = await adminClient.from(table).select(columns).eq(column, value).maybeSingle();
        if (!res || res.error) return { unreadable: true };
        return { row: res.data ?? null };
    } catch {
        return { unreadable: true };
    }
}

async function accountReadiness(adminClient, users, email, now) {
    const want = normalize(email);
    const owners = users.filter((u) => normalize(u?.email) === want);
    if (owners.length === 0) return { email, state: 'missing', reason: 'no-auth-owner' };
    if (owners.length > 1) return { email, state: 'ambiguous', reason: 'several-auth-owners' };
    const id = owners[0].id;
    if (typeof id !== 'string' || !id) return { email, state: 'unreadable', reason: 'auth-owner-id' };

    const profile = await readOne(adminClient, 'user_profiles', 'id, trial_started_at, trial_expires_at, commercial_trial_granted_at', 'id', id);
    if (profile.unreadable) return { email, state: 'unreadable', reason: 'profile-read' };
    if (!profile.row) return { email, state: 'missing', reason: 'no-profile' };
    const ledger = await readOne(adminClient, 'trial_entitlements', 'email, user_id, trial_started_at, trial_expires_at', 'email', want);
    if (ledger.unreadable) return { email, state: 'unreadable', reason: 'entitlement-read' };
    if (!ledger.row) return { email, state: 'missing', reason: 'no-trial-entitlement' };
    if (ledger.row.user_id !== id) return { email, state: 'ambiguous', reason: 'entitlement-bound-to-another-owner' };

    const grant = instant(profile.row.commercial_trial_granted_at);
    const expiry = instant(profile.row.trial_expires_at);
    const ledgerExpiry = instant(ledger.row.trial_expires_at);
    if ([grant, expiry, ledgerExpiry].some((v) => Number.isNaN(v))) return { email, state: 'unreadable', reason: 'trial-date' };
    if (grant === null || expiry === null || ledgerExpiry === null) return { email, state: 'missing', reason: 'no-trial-grant' };
    if (expiry !== ledgerExpiry) return { email, state: 'ambiguous', reason: 'profile-and-entitlement-expiry-differ' };
    const expiresAt = new Date(expiry).toISOString();
    if (expiry <= now) return { email, state: 'expired', reason: 'trial-expired', expiresAt };
    return { email, state: 'active', reason: 'active-trial', expiresAt };
}

/** { ready, accounts: [{ email, state, reason, expiresAt? }] } — reads only; never throws for an unavailable read. */
export async function enduranceReadiness({ adminClient, emails, now = Date.now() }) {
    if (!Array.isArray(emails) || emails.length === 0 || !Number.isFinite(now)) {
        return { ready: false, accounts: [{ email: null, state: 'unreadable', reason: 'invalid-input' }] };
    }
    const users = await authInventory(adminClient);
    if (users === null) {
        return { ready: false, accounts: emails.map((email) => ({ email, state: 'unreadable', reason: 'auth-inventory' })) };
    }
    const accounts = [];
    for (const email of emails) accounts.push(await accountReadiness(adminClient, users, email, now));
    return { ready: accounts.every((a) => a.state === 'active'), accounts };
}
