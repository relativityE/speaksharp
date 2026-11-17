'use strict';
// #1884 (Sam, 17 Nov, design approval for offline implementation only): J4.a teardown is PARENT-owned. The service-role admin path
// never reaches the child. Order, each step fail-closed:
//   1. the child has exited and its owned pages were verified closed; otherwise HOLD, nothing deleted;
//   2. ownership comes from the journey's ONE durable create record (sent, answered `created`, the J4.a leg, the run's fixed test
//      domain), the exact reserved email rebuilt from it, the parent channel's own confirmed reference, and an independent exact-
//      email lookup that finds exactly one run-owned account, re-read by id to the same email. Never a child-supplied id, never an
//      email match alone. Missing, ambiguous or mismatched: HOLD with no deletes;
//   3. every admin call is a narrowly scoped request under `nightly.cleanup` (a refused reservation is a failed step);
//   4. delete (pre-delete `trial_entitlements` by user id, the auth user), then prove deletion: ONLY a documented not-found re-read;
//   5. zero residue for the SAME preserved owner id: account (not-found re-read), sessions and active_recording_lease counts.
// An interrupted cleanup, a failed lookup or a missing query is never PASS: the returned evidence then has no complete
// verification and the bridge reads the journey's cleanup as incomplete. Reasons are content-free (no id, email or row).
const { enumerateUsers, exactEmailLookup } = require('./account-lookup.cjs');
const { reservationEmail } = require('./account-reservation.cjs');
const { isCount } = require('./counts.cjs');
const { LEG, RUN_OWNED_PREFIX } = require('./j4a-guarded-step.cjs');

const isNotFound = (e) => !!e && e.status === 404 && /user_not_found|not[_\s-]?found|does not exist|no user/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
const COUNTED = Object.freeze([['session', 'sessions'], ['lease', 'active_recording_lease']]);

/**
 * `nightly`: the bridge's routes. `admin`: the parent's service-role client (auth.admin.listUsers/getUserById/deleteUser, from()).
 * `createRecord`: cleanup-evidence journeyCreateRecord(dir, runId, 'J4'). `confirmedAccount`: the parent channel's own record of
 * the confirmed create. `childClosed`: { exited, ownedPagesClosed } observed by the parent after the child ended.
 * Resolves { hold: null | reason, nightlyCleanup }.
 */
async function j4aParentTeardown({ nightly, admin, createRecord, runId, configuredDomain, confirmedAccount, childClosed }) {
    const steps = [];
    const sent = createRecord?.sent;
    const ref = typeof sent?.lookupRef === 'string' ? sent.lookupRef : null;
    const hold = (reason, left = ref ? [{ kind: 'account', ref }] : []) => ({ hold: reason, nightlyCleanup: { steps: [...steps], left } });
    if (childClosed?.exited !== true || childClosed?.ownedPagesClosed !== true) return hold('the child has not exited with its owned pages verified closed');
    if (!sent) return hold('no single durable create record for the journey', []);
    if (createRecord.answered?.result?.outcome !== 'created') return hold('the durable create record is not answered created');
    if (sent.leg !== LEG || typeof sent.emailDomain !== 'string' || typeof configuredDomain !== 'string' || sent.emailDomain !== configuredDomain.toLowerCase())
        return hold('the durable create record is not this leg under the run\'s fixed test domain');
    let email;
    try { email = reservationEmail({ prefix: RUN_OWNED_PREFIX, journey: 'J4', runId, runAttempt: '1', domain: sent.emailDomain }); }
    catch { return hold('the reserved email cannot be rebuilt from the durable record'); }
    if (email.slice(0, email.indexOf('@')) !== ref || confirmedAccount !== ref) return hold('ownership mismatched: the durable record, the reserved email and the confirmed create disagree');

    const call = async (fn) => {
        const r = await nightly.cleanup(LEG, fn);
        if (!r || r.sent !== true) { const e = new Error('cleanup reservation refused'); e.code = 'CLEANUP_REFUSED'; throw e; }
        return r.value;
    };
    const found = exactEmailLookup(await enumerateUsers((args) => call(() => admin.auth.admin.listUsers(args))), { email, runOwnedPrefix: RUN_OWNED_PREFIX });
    if (found.lookup !== 'one') return hold(`the independent lookup is ${found.lookup}, so nothing is deleted`);
    const owner = found.uid;
    try {
        const reread = await call(() => admin.auth.admin.getUserById(owner));
        if (reread?.error || String(reread?.data?.user?.email ?? '').toLowerCase() !== email) return hold('the account re-read by id does not carry the reserved email');
    } catch { return hold('the account could not be re-read by id'); }

    const step = async (action, fn) => {
        try { const r = await call(fn); if (r?.error) throw new Error('admin error'); steps.push({ kind: 'account', ref, action, outcome: 'done' }); return true; }
        catch { steps.push({ kind: 'account', ref, action, outcome: 'failed' }); return false; }
    };
    if (!await step('pre-delete-trial-entitlements', () => admin.from('trial_entitlements').delete().eq('user_id', owner))) return hold('partial cleanup: pre-delete failed');
    if (!await step('delete', () => admin.auth.admin.deleteUser(owner))) return hold('partial cleanup: the account delete failed');
    try {
        const proof = await call(() => admin.auth.admin.getUserById(owner));
        if (!isNotFound(proof?.error)) { steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'failed' }); return hold('deletion not proven: only a not-found re-read proves it'); }
        steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'done' });
    } catch { steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'failed' }); return hold('deletion not proven: the re-read was refused or failed'); }

    // Zero residue for the SAME preserved owner id. Anything but an observed whole number is not observed (never zero).
    const queries = [];
    try {
        const a = await call(() => admin.auth.admin.getUserById(owner));
        queries.push({ kind: 'account', scope: ref, count: isNotFound(a?.error) ? 0 : a?.data?.user ? 1 : null });
    } catch { queries.push({ kind: 'account', scope: ref, count: null }); }
    for (const [kind, table] of COUNTED) {
        try {
            const r = await call(() => admin.from(table).select('user_id', { count: 'exact', head: true }).eq('user_id', owner));
            queries.push({ kind, scope: ref, count: !r?.error && isCount(r?.count) ? r.count : null });
        } catch { queries.push({ kind, scope: ref, count: null }); }
    }
    return { hold: null, nightlyCleanup: { steps, left: [], verification: { kind: 'zero-residue', queries } } };
}

module.exports = { j4aParentTeardown };
