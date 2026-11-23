'use strict';
// #1884 (Sam, 17 Nov): J4.a teardown is PARENT-owned; the service-role admin path never reaches the child. Two phases, two budgets:
//
// BIND (confirmJ4aOwner, once, before the guard binds the owner): ownership from the journey's ONE durable create record (answered
// `created`, this leg, the run's fixed test domain), the reserved email rebuilt from it, the parent channel's confirmed reference, and
// an exact-email lookup of exactly one run-owned account re-read by id to that email. Its admin requests use the transport's own capped
// `bind` allowance (admin-transport.cjs), never the journey's cleanup reserve.
//
// TEARDOWN (j4aParentTeardown), each step fail-closed, every admin request reserved under `nightly.cleanup` AND counted by the transport's
// `teardown` allowance, each with an enforced per-request deadline:
//   1. the child exited with its owned pages verified closed; the preserved (bound) owner exists; the durable record still agrees;
//   2. NO second enumeration: the preserved owner is re-read by id and must carry the reserved email;
//   3. settlement (the established path, runOwnedCleanup.ts settleRunOwnedTakes semantics; classifyTakes is drift-tested against it):
//      open takes are closed only with the stopped-writer proof, never a take whose save may still be admitted; an unsettleable take
//      or a lease with no take stops here (the unsettled-save guard on auth.users would refuse the delete);
//   4. before the FIRST delete: the remaining reserve and allowance cover every remaining request (closes, pre-delete, delete, proof,
//      one read per required store), so deletion never starts without the time to finish and read back;
//   5. pre-delete trial_entitlements by user id, delete the auth user (an unsettled-save refusal is named, never retried or bypassed),
//      prove deletion by a not-found re-read only;
//   6. one scoped zero per required store (residue-inventory.cjs: the shared helper's checks, trial_entitlements by the reserved EMAIL,
//      account_save_obligations, the account), each query carrying its own `store` identity.
// THE SAVE JOURNAL (Sam, 17 Nov; reproduced on the real chain in tests/db/j4a-save-journal-cleanup-1884): account_save_obligations has no
// Auth FK, service_role cannot read it, the delete guard refuses only UNSETTLED rows, and a completed row survives the Auth delete. So
// teardown needs a reviewed, run-bound `saveJournal` { bound: { runId, owner }, settle, remove, readBack } to settle the rows before the
// delete, remove the terminal rows after it, and independently read back zero. Without one, teardown is HOLD before ANY request, so
// nothing destructive happens. The production entry supplies none: adding one is a reviewed change, never a fallback. Grants and the
// delete guard are never touched.
// Unknown, unreadable, omitted or refused is HOLD, never zero. Reasons are content-free (no id, email or row).
const { enumerateUsers, exactEmailLookup } = require('./account-lookup.cjs');
const { reservationEmail } = require('./account-reservation.cjs');
const { isCount } = require('./counts.cjs');
const { LEG, RUN_OWNED_PREFIX } = require('./j4a-guarded-step.cjs');
const { readJ4aStoppedWriters } = require('./j4a-writer-evidence.cjs');
const { j4aRequiredStores } = require('./residue-inventory.cjs');

const isNotFound = (e) => !!e && e.status === 404 && /user_not_found|not[_\s-]?found|does not exist|no user/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
const isUnsettledSaveRefusal = (e) => !!e && (e.code === '55000' || /account admitted save unsettled/i.test(String(e.message ?? '')));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KIND_OF = Object.freeze({ sessions: 'session', active_recording_lease: 'lease' });

/** runOwnedCleanup.ts classifyTakes, the same rule (drift-tested): settled, closable (an active take anchored by a lease or fence), unsettleable. */
function classifyTakes(rows) {
    let settled = 0; let unsettleable = 0; const closable = [];
    for (const row of rows) {
        const anchored = row.lease_id !== null || row.recording_fenced_at !== null;
        if (row.status === 'completed' || (row.status === 'failed' && anchored)) settled += 1;
        else if (anchored && row.status === 'active') closable.push(row);
        else unsettleable += 1;
    }
    return { settled, closable, unsettleable };
}
/** runOwnedCleanup.ts leaseOnlyTakes: leases the account still holds that no take was created under. */
function leaseOnlyTakes(leaseIds, rows) {
    const bound = new Set(rows.map((r) => r.lease_id).filter((l) => l !== null));
    return leaseIds.filter((l) => typeof l === 'string' && !bound.has(l)).length;
}

/** The durable-record, reserved-email and confirmed-reference agreement both phases require. { email, ref } or { hold }. */
function ownershipPreconditions({ createRecord, runId, configuredDomain, confirmedAccount }) {
    const sent = createRecord?.sent;
    const ref = typeof sent?.lookupRef === 'string' ? sent.lookupRef : null;
    if (!sent) return { hold: 'no single durable create record for the journey', ref };
    if (createRecord.answered?.result?.outcome !== 'created') return { hold: 'the durable create record is not answered created', ref };
    if (sent.leg !== LEG || typeof sent.emailDomain !== 'string' || typeof configuredDomain !== 'string' || sent.emailDomain !== configuredDomain.toLowerCase())
        return { hold: 'the durable create record is not this leg under the run\'s fixed test domain', ref };
    let email;
    try { email = reservationEmail({ prefix: RUN_OWNED_PREFIX, journey: 'J4', runId, runAttempt: '1', domain: sent.emailDomain }); }
    catch { return { hold: 'the reserved email cannot be rebuilt from the durable record', ref }; }
    if (email.slice(0, email.indexOf('@')) !== ref || confirmedAccount !== ref) return { hold: 'ownership mismatched: the durable record, the reserved email and the confirmed create disagree', ref };
    return { email, ref };
}

/**
 * BIND: the parent's independent owner confirmation. `transport` (admin-transport.cjs) is switched to its `bind` allowance; nothing here
 * touches the cleanup reserve. Resolves { owner, ref } or { hold, ref } (content-free).
 */
async function confirmJ4aOwner({ admin, transport, createRecord, runId, configuredDomain, confirmedAccount }) {
    const pre = ownershipPreconditions({ createRecord, runId, configuredDomain, confirmedAccount });
    if (pre.hold) return { hold: pre.hold, ref: pre.ref };
    if (!transport || typeof transport.setPhase !== 'function' || typeof transport.fetch !== 'function')
        return { hold: 'no bounded admin transport, so the lookup has no enforced allowance and nothing is sent', ref: pre.ref };
    transport.setPhase('bind');
    const found = exactEmailLookup(await enumerateUsers((args) => admin.auth.admin.listUsers(args)), { email: pre.email, runOwnedPrefix: RUN_OWNED_PREFIX });
    if (found.lookup !== 'one') return { hold: `the independent lookup is ${found.lookup}, so nothing is bound or deleted`, ref: pre.ref };
    try {
        const reread = await admin.auth.admin.getUserById(found.uid);
        if (reread?.error || String(reread?.data?.user?.email ?? '').toLowerCase() !== pre.email) return { hold: 'the account re-read by id does not carry the reserved email', ref: pre.ref };
    } catch { return { hold: 'the account could not be re-read by id', ref: pre.ref }; }
    return { owner: found.uid, ref: pre.ref };
}

/**
 * TEARDOWN. `preservedOwner`: the owner confirmed at bind. `stopped`: a verified parent-only stopped-writer capability
 * for this binding, run and owner. Missing proof refuses all inline teardown, including when no takes need closing. `transport` (required): the admin client's bounded transport, whose
 * per-request deadline and teardown allowance are enforced where requests are sent. `timeLeftMs()` (required): teardown's remaining time;
 * unknown time is HOLD, never "unbounded". `observeTakes(rows)` (optional): sees the owner's takes ({ id, status }) once they are read,
 * before any delete; it changes nothing. Resolves { hold, nightlyCleanup }.
 */
async function j4aParentTeardown({ nightly, admin, transport, createRecord, runId, configuredDomain, confirmedAccount, childClosed, preservedOwner,
    stopped = null, binding = null, deadlineMs = transport?.deadlineMs ?? null, timeLeftMs = null, saveJournal = null, storesSource, observeTakes = null }) {
    const steps = [];
    const ref = typeof createRecord?.sent?.lookupRef === 'string' ? createRecord.sent.lookupRef : null;
    const hold = (reason, left = ref ? [{ kind: 'account', ref }] : []) => ({ hold: reason, nightlyCleanup: { steps: [...steps], left } });
    if (childClosed?.exited !== true || childClosed?.ownedPagesClosed !== true) return hold('the child has not exited with its owned pages verified closed');
    if (!createRecord?.sent) return hold('no single durable create record for the journey', []);
    const pre = ownershipPreconditions({ createRecord, runId, configuredDomain, confirmedAccount });
    if (pre.hold) return hold(pre.hold);
    if (typeof preservedOwner !== 'string' || !UUID.test(preservedOwner)) return hold('no owner was preserved at binding, so teardown cannot know whom to delete (recovery required)');
    const owner = preservedOwner;
    if (!readJ4aStoppedWriters(stopped, { binding, runId, owner }))
        return hold('no verified stopped-writer evidence for this run and owner, so nothing is sent or deleted');
    let stores;
    try { stores = j4aRequiredStores(storesSource); } catch { return hold('the required store inventory could not be read'); }
    // Nothing is sent unless both bounds exist: the transport that enforces the deadline and allowance, and a clock for the time left.
    if (!transport || typeof transport.setPhase !== 'function' || typeof transport.remaining !== 'function' || typeof transport.fetch !== 'function')
        return hold('no bounded admin transport, so no request deadline or allowance is enforced and nothing is sent');
    if (typeof timeLeftMs !== 'function') return hold('the time left for teardown is unknown, so nothing is sent');
    const journal = saveJournal;
    if (!journal || typeof journal.settle !== 'function' || typeof journal.remove !== 'function' || typeof journal.readBack !== 'function'
        || journal.bound?.runId !== runId || journal.bound?.owner !== owner)
        return hold('no reviewed, run-bound way to settle, remove and read back the save journal (account_save_obligations), so nothing is sent or deleted');
    transport.setPhase('teardown');
    const call = async (fn) => {
        const r = await nightly.cleanup(LEG, fn);
        if (!r || r.sent !== true) { const e = new Error('cleanup reservation refused'); e.code = 'CLEANUP_REFUSED'; throw e; }
        return r.value;
    };

    // 2. The preserved owner, re-read by id, must still carry the reserved email. No second enumeration.
    try {
        const reread = await call(() => admin.auth.admin.getUserById(owner));
        if (reread?.error || String(reread?.data?.user?.email ?? '').toLowerCase() !== pre.email) return hold('the preserved owner re-read by id does not carry the reserved email');
    } catch { return hold('the preserved owner could not be re-read by id'); }

    // 3. Settlement (established semantics). Read takes and leases for this owner.
    let takes;
    try {
        const s = await call(() => admin.from('sessions').select('id,status,lease_id,recording_fenced_at').eq('user_id', owner));
        const l = await call(() => admin.from('active_recording_lease').select('lease_id').eq('user_id', owner));
        if (s?.error || l?.error || !Array.isArray(s?.data) || !Array.isArray(l?.data)) return hold('takes or leases could not be read, so settlement is unknown');
        takes = { rows: s.data, leases: l.data };
    } catch { return hold('takes or leases could not be read, so settlement is unknown'); }
    // The J4.a save witness (j4a-save-witness.cjs) checks the saved takes against the parent's own read, before anything is deleted.
    if (typeof observeTakes === 'function') try { observeTakes(takes.rows.map((r) => ({ id: r.id, status: r.status }))); } catch { /* observation only */ }
    const c = classifyTakes(takes.rows);
    if (c.unsettleable > 0) return hold(`${c.unsettleable} take(s) cannot be settled, so the unsettled-save guard would refuse deletion`);
    if (leaseOnlyTakes(takes.leases.map((x) => x.lease_id), takes.rows) > 0) return hold('a lease is held with no take under it, so the unsettled-save guard would refuse deletion');
    const toClose = c.closable; // The verified parent capability refuses any unresolved writer, not just observed open takes.

    // 4. Before the FIRST delete: every remaining request fits the remaining reserve, the transport allowance and the time left.
    const needed = toClose.length + 5 + stores.length; // closes, journal settle, pre-delete, delete, proof, journal remove, one read per store
    const reserve = typeof nightly.cleanupRemaining === 'function' ? nightly.cleanupRemaining(LEG) : null;
    const allowance = transport.remaining('teardown');
    const time = timeLeftMs();
    if (!Number.isSafeInteger(reserve) || reserve < needed) return hold(`the cleanup reserve cannot cover the ${needed} remaining request(s), so nothing is deleted`);
    if (!Number.isSafeInteger(allowance) || allowance < needed) return hold(`the teardown allowance cannot cover the ${needed} remaining request(s), so nothing is deleted`);
    if (!Number.isFinite(time) || !Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || time < needed * deadlineMs)
        return hold('the time left cannot cover every remaining request at its deadline, so nothing is deleted');

    const step = async (action, fn, onError, verifies = null) => {
        try {
            const r = await call(fn);
            if (r?.error) { steps.push({ kind: 'account', ref, action, outcome: 'failed' }); return onError?.(r.error) ?? 'failed'; }
            if (verifies && !verifies(r)) { steps.push({ kind: 'account', ref, action, outcome: 'failed' }); return 'failed'; }
            steps.push({ kind: 'account', ref, action, outcome: 'done' });
            return 'done';
        } catch { steps.push({ kind: 'account', ref, action, outcome: 'failed' }); return 'failed'; }
    };
    for (const row of toClose) {
        // Exactly this row of this account, only while still the `active` take that was read; only rows the database changed count.
        const r = await step('settle-close-take', () => admin.from('sessions').update({ status: 'failed' }).eq('id', row.id).eq('user_id', owner).eq('status', 'active').select('id'), null,
            (reply) => Array.isArray(reply?.data) && reply.data.length === 1 && reply.data[0]?.id === row.id);
        if (r !== 'done') return hold('partial cleanup: an open take could not be settled');
    }
    if (await step('settle-save-journal', () => journal.settle(owner)) !== 'done') return hold('partial cleanup: the save journal could not be settled, so nothing is deleted');
    if (await step('pre-delete-trial-entitlements', () => admin.from('trial_entitlements').delete().eq('user_id', owner)) !== 'done') return hold('partial cleanup: pre-delete failed');
    const deleted = await step('delete', () => admin.auth.admin.deleteUser(owner), (e) => (isUnsettledSaveRefusal(e) ? 'unsettled' : 'failed'));
    if (deleted === 'unsettled') return hold('deletion refused: an admitted save is unsettled (the guard was not bypassed)');
    if (deleted !== 'done') return hold('partial cleanup: the account delete failed');
    try {
        const proof = await call(() => admin.auth.admin.getUserById(owner));
        if (!isNotFound(proof?.error)) { steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'failed' }); return hold('deletion not proven: only a not-found re-read proves it'); }
        steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'done' });
    } catch { steps.push({ kind: 'account', ref, action: 'prove-deleted', outcome: 'failed' }); return hold('deletion not proven: the re-read was refused or failed'); }
    // The completed journal rows survive the Auth delete; remove them through the same reviewed path.
    if (await step('remove-save-journal', () => journal.remove(owner)) !== 'done') return hold('partial cleanup: the save journal rows could not be removed');

    // 6. One scoped zero per required store, each with its own identity. Anything but an observed whole number is not observed.
    const queries = [];
    for (const s of stores) {
        const kind = KIND_OF[s.table] ?? 'account';
        let count = null;
        try {
            if (s.table === 'account_save_obligations') {
                // Never a service-role read (refused by the migration): the journal path's own independent read-back.
                const r = await call(() => journal.readBack(owner));
                count = !r?.error && isCount(r?.count) ? r.count : null;
            } else if (s.id === 'auth:account') {
                const a = await call(() => admin.auth.admin.getUserById(owner));
                count = isNotFound(a?.error) ? 0 : a?.data?.user ? 1 : null;
            } else {
                const value = s.key === 'email' ? pre.email : owner;
                const r = await call(() => admin.from(s.table).select(s.column, { count: 'exact', head: true }).eq(s.column, value));
                count = !r?.error && isCount(r?.count) ? r.count : null;
            }
        } catch { count = null; }
        queries.push({ kind, store: s.id, scope: ref, count });
    }
    return { hold: null, nightlyCleanup: { steps, left: [], verification: { kind: 'zero-residue', queries } } };
}

module.exports = { classifyTakes, confirmJ4aOwner, j4aParentTeardown, leaseOnlyTakes };
