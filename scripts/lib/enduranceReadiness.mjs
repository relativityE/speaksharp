/**
 * Browser-endurance account readiness — READ-ONLY, injectable, FAIL-CLOSED (Stress and Endurance run 42474354454; Sam 1794138777,
 * 1794138818, 1794141451, 1794141486).
 *
 * The dedicated endurance accounts must already be genuine active-trial accounts before the soak setup performs ANY write. Recreating
 * an account cannot restore a trial: `public.ensure_trial_profile_for_new_user` (migration 20261013180000) keys
 * `public.trial_entitlements` by e-mail and copies the historical trial dates onto a recreated profile.
 *
 * The eligibility decision is NOT a parallel rule: it is the existing read-only `verifyCanaryFoundation(adminClient, userId,
 * 'free_test')` contract (scripts/lib/canaryAccountAdmin.mjs) — the genuine standard Free account with an active 30-day trial —
 * whose "active" verdict is the canonical five-argument `public.effective_subscription_tier` RPC evaluated with the DATABASE's now().
 * No runner clock and no HTTP response time is consulted. This module adds only identity checks around it:
 *   - the Auth inventory has exactly one owner for the address (a truncated or failed inventory is unreadable);
 *   - the e-mail's `trial_entitlements` row is bound to that owner with exactly the profile's trial window.
 * Each account is `active`, `expired`, `ineligible`, `missing`, `ambiguous` or `unreadable`; `ready` only when every account is `active`.
 * It never creates, deletes, renames, resets a password, stamps or extends a trial (the RPC is a read-only function call).
 */
import { verifyCanaryFoundation } from './canaryAccountAdmin.mjs';

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const ENDURANCE_PURPOSE = 'free_test';   // verify:'trial' — a genuine standard Free account with an active 30-day trial

const normalize = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

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

async function readLedger(adminClient, email) {
    try {
        const res = await adminClient.from('trial_entitlements').select('email, user_id, trial_started_at, trial_expires_at').eq('email', email).maybeSingle();
        if (!res || res.error) return { unreadable: true };
        return { row: res.data ?? null };
    } catch {
        return { unreadable: true };
    }
}

/** Map the shared foundation verdict to a readiness state (closed reason codes only). */
function stateOfFoundation(verdict) {
    if (verdict.ok) return 'active';
    const reason = String(verdict.reason || '');
    if (reason === 'trial_not_active_server_time') return 'expired';
    if (reason === 'profile_missing_after_foundation') return 'missing';
    if (reason.startsWith('profile_readback_error') || reason.startsWith('tier_rpc_error')) return 'unreadable';
    return 'ineligible';
}

async function accountReadiness(adminClient, users, email) {
    const want = normalize(email);
    const owners = users.filter((u) => normalize(u?.email) === want);
    if (owners.length === 0) return { email, state: 'missing', reason: 'no-auth-owner' };
    if (owners.length > 1) return { email, state: 'ambiguous', reason: 'several-auth-owners' };
    const id = owners[0].id;
    if (typeof id !== 'string' || !id) return { email, state: 'unreadable', reason: 'auth-owner-id' };

    let verdict;
    try {
        verdict = await verifyCanaryFoundation(adminClient, id, ENDURANCE_PURPOSE);
    } catch {
        return { email, state: 'unreadable', reason: 'foundation-read' };
    }
    const state = stateOfFoundation(verdict);
    if (state !== 'active') return { email, state, reason: String(verdict.reason || 'foundation') };

    const ledger = await readLedger(adminClient, want);
    if (ledger.unreadable) return { email, state: 'unreadable', reason: 'entitlement-read' };
    if (!ledger.row) return { email, state: 'missing', reason: 'no-trial-entitlement' };
    if (ledger.row.user_id !== id) return { email, state: 'ambiguous', reason: 'entitlement-bound-to-another-owner' };
    const same = (a, b) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
    const profile = verdict.snapshot || {};
    if (!same(ledger.row.trial_started_at, profile.trial_started_at) || !same(ledger.row.trial_expires_at, profile.trial_expires_at)) {
        return { email, state: 'ambiguous', reason: 'profile-and-entitlement-window-differ' };
    }
    return { email, state: 'active', reason: 'active-trial-server-time' };
}

/** { ready, accounts: [{ email, state, reason }] } — reads only (Auth list, profile, entitlement, the read-only tier RPC). */
export async function enduranceReadiness({ adminClient, emails }) {
    if (!Array.isArray(emails) || emails.length === 0) {
        return { ready: false, accounts: [{ email: null, state: 'unreadable', reason: 'invalid-input' }] };
    }
    const users = await authInventory(adminClient);
    if (users === null) {
        return { ready: false, accounts: emails.map((email) => ({ email, state: 'unreadable', reason: 'auth-inventory' })) };
    }
    const accounts = [];
    for (const email of emails) accounts.push(await accountReadiness(adminClient, users, email));
    return { ready: accounts.every((a) => a.state === 'active'), accounts };
}
