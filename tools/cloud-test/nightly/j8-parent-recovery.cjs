'use strict';
// J8 parent recovery (Sam on 27ee1856: "Choose (b) ... The parent should use the protected landed-and-cleaned path: independently
// verify the exact reserved account belongs to this run and attempt, delete only that account and its verified run-owned resources,
// then require complete residue checks before clearing the journal. Missing, ambiguous, or late evidence stays HOLD.")
//
// A UI signup gives the parent no trusted answer, so the run's ONE create attempt is resolved the only other way the create journal
// accepts (cleanup-evidence.cjs `landed-and-cleaned`), by the parent, after the spec has exited:
//   1. BIND: the journey's one durable create record is this attempt, for this exact reservation (local part and fixed domain);
//   2. FIND: a COMPLETE exact-email listing finds exactly ONE run-owned account under the reserved email (zero, ambiguous, not
//      run-owned or unreadable writes nothing: absence proves nothing, the create may still land);
//   3. OWNER: that account, re-read by id, carries the reserved email, was created after the attempt was recorded, and is bound
//      (app_metadata.ct_run, exactly) to THIS run and attempt. Anything else writes nothing and deletes nothing;
//   4. LANDED: only then is the account recorded as landed (recordAttemptLanded re-checks it against the journey's one create);
//   5. DELETE: the scoped path deletes exactly that account (runOwnedCleanup.ts cleanupRunOwnedAccount in the live adapter, which
//      re-checks the email, the run-owned prefix and the run binding itself);
//   6. RESIDUE: the parent's OWN read of every required store (residue-inventory.cjs: the shared helper's 23 owner-scoped checks,
//      trial_entitlements by the reserved email, the save journal, the account itself), each an observed zero, then a second
//      complete listing with no account under the reserved email;
//   7. RECOVERED: recordAttemptRecovery('landed-and-cleaned') validates the proof against the landed record and clears the attempt.
// Every read is cut off at what is left of the cleanup budget, and a step that ends after it never counts (late evidence is HOLD).
// The delete is the one step that is never abandoned (Sam on 65365f36): it is GIVEN what is left of the budget, must stop and drain
// its own process tree inside it, and is awaited, so no HOLD is reported while it may still be running.
// Reasons are content-free: never an email, an id or a row.
const crypto = require('node:crypto');
const { journeyCreateRecord, recordAttemptLanded, recordAttemptRecovery, RESOURCE_KINDS } = require('./cleanup-evidence.cjs');
const { j4aRequiredStores, sharedResidueChecks } = require('./residue-inventory.cjs');
const { isCount } = require('./counts.cjs');

const JOURNEY = 'J8';
const RUN_OWNED_PREFIX = 'rwt-journey-';
const BINDING_KEYS = Object.freeze(['repository', 'workflow', 'runId', 'runAttempt', 'role']);
const KIND_OF = Object.freeze({ sessions: 'session', active_recording_lease: 'lease' });
const LATE = Symbol('late');

/** Only a digest of the server id reaches the evidence directory (signup-recovery.cjs does the same). */
const accountRefOf = (uid) => `account-${crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 24)}`;

/** Exactly this run's binding: the same five keys and values (runBinding.ts sameRunBinding). */
function sameBinding(ctRun, expected) {
    if (!ctRun || typeof ctRun !== 'object' || Array.isArray(ctRun) || !expected) return false;
    return Object.keys(ctRun).length === BINDING_KEYS.length && BINDING_KEYS.every((k) => typeof expected[k] === 'string' && expected[k] && ctRun[k] === expected[k]);
}

/**
 * The parent's recovery of this run's one create attempt. `deps`: lookup({ email, runOwnedPrefix }) -> exactEmailLookup's result;
 * readAccount(uid) -> { email, createdAt, ctRun } | null; scopedDelete({ uid, email, binding }) -> { deleted: true } only when the scoped path
 * proved the delete, `drained: false` when its process tree could not be confirmed stopped; it must itself end within `timeoutMs`
 * (the adapter kills and drains its process); readResidue({ store, table, column, key, uid, email }) -> an observed count, or null. `binding`: this run's
 * expected app_metadata.ct_run. Resolves { state: 'recovered' | 'hold', reason, landed, deleted, queries }; never throws.
 */
async function j8ParentRecovery({ evidenceDir, admission, binding, deps, budgetMs, now = () => Date.now(), storesSource } = {}) {
    const out = { state: 'hold', reason: '', landed: false, deleted: false, queries: [] };
    const hold = (reason) => ({ ...out, reason });
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) return hold('no cleanup budget, so nothing is looked up or deleted');
    const deadlineAt = now() + budgetMs;
    const left = () => deadlineAt - now();
    /** `fn()` cut off at what is left of the budget; a result that arrives after it is LATE, never evidence. */
    const timely = async (fn) => {
        if (left() <= 0) return LATE;
        let timer;
        try {
            const r = await Promise.race([Promise.resolve().then(fn), new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), Math.max(0, left())); })]);
            return left() < 0 ? LATE : r;
        } catch { return null; }
        finally { clearTimeout(timer); }
    };
    for (const k of ['lookup', 'readAccount', 'scopedDelete', 'readResidue'])
        if (typeof deps?.[k] !== 'function') return hold('no parent lookup, owner read, scoped delete and residue read, so nothing is deleted');
    if (!sameBinding(binding, binding)) return hold('the parent has no run binding to check the account against, so nothing is deleted');
    let stores;
    let shared;
    try { stores = j4aRequiredStores(storesSource); shared = new Set(sharedResidueChecks(storesSource).map((c) => `${c.table}:${c.column}`)); }
    catch { return hold('the required store inventory could not be read, so nothing is deleted'); }

    // 1. BIND: the journey's one durable create record is this attempt's reservation.
    const record = journeyCreateRecord(evidenceDir, admission.recordRunId, JOURNEY);
    const sent = record?.sent;
    if (!sent || sent.attemptId !== admission.attemptId || sent.lookupRef !== admission.local || sent.emailDomain !== admission.domain)
        return hold('the run\'s create record is not this attempt\'s reservation, so nothing is looked up or deleted');
    const email = `${sent.lookupRef}@${sent.emailDomain}`;

    // 2. FIND: a complete listing, exactly one run-owned account.
    const found = await timely(() => deps.lookup({ email, runOwnedPrefix: RUN_OWNED_PREFIX }));
    if (found === LATE) return hold('the listing did not finish within the cleanup budget, so nothing is deleted');
    if (found?.lookup !== 'one' || typeof found.uid !== 'string' || !found.uid)
        return hold(`the reservation lookup is ${typeof found?.lookup === 'string' ? found.lookup : 'unreadable'}, so nothing is recorded or deleted`);
    const uid = found.uid;

    // 3. OWNER: re-read by id; the reserved email, created after the attempt was recorded, bound to THIS run and attempt.
    const account = await timely(() => deps.readAccount(uid));
    if (account === LATE) return hold('the owner re-read did not finish within the cleanup budget, so nothing is deleted');
    if (!account || String(account.email ?? '').toLowerCase() !== email.toLowerCase())
        return hold('the account re-read by id does not carry the reserved email, so nothing is recorded or deleted');
    const created = Date.parse(account.createdAt);
    if (!Number.isFinite(created) || created < Date.parse(sent.recordedAt))
        return hold('the account was not created after this attempt was recorded, so it is not this attempt\'s; nothing is deleted');
    if (!sameBinding(account.ctRun, binding))
        return hold('the account is not bound to this run and attempt, so nothing is recorded or deleted');

    // 4. LANDED.
    try {
        recordAttemptLanded(evidenceDir, admission.recordRunId, admission.attemptId,
            { lookupRef: sent.lookupRef, lookup: 'one', accountRef: accountRefOf(uid), observedAt: new Date(now()).toISOString() }, new Date(now()).toISOString());
    } catch { return hold('the found account could not be recorded as landed, so nothing is deleted'); }
    out.landed = true;

    // 5. DELETE through the scoped path, given what is left of the budget and awaited (never abandoned while it may still run).
    let del;
    try { del = await deps.scopedDelete({ uid, email, binding, timeoutMs: left() }); } catch { del = null; }
    if (del?.drained === false) return hold('the scoped delete\'s processes could not be confirmed stopped; the landed account is left for protected recovery');
    if (left() <= 0) return hold('the scoped delete did not finish within the cleanup budget; the landed account is left for protected recovery');
    if (del?.deleted !== true) return hold('the scoped delete did not prove the account deleted; the landed account is left for protected recovery');
    out.deleted = true;

    // 6. RESIDUE: the parent's own observed zero for every required store, then a second complete listing at zero.
    const queries = [];
    for (const s of stores) {
        const count = await timely(() => deps.readResidue({ store: s.id, table: s.table, column: s.column, key: s.key, uid, email }));
        queries.push({ kind: RESOURCE_KINDS.includes(KIND_OF[s.table]) ? KIND_OF[s.table] : 'account', store: s.id, scope: sent.lookupRef,
            count: count === LATE || !isCount(count) ? null : count });
    }
    out.queries = queries;
    const unobserved = queries.filter((q) => q.count === null).length;
    const nonZero = queries.filter((q) => q.count !== null && q.count !== 0).length;
    if (unobserved > 0) return hold(`${unobserved} residue read(s) were not observed within the cleanup budget`);
    if (nonZero > 0) return hold(`${nonZero} store(s) still hold residue after the delete`);
    const after = await timely(() => deps.lookup({ email, runOwnedPrefix: RUN_OWNED_PREFIX }));
    if (after === LATE) return hold('the listing after the delete did not finish within the cleanup budget');
    if (after?.lookup !== 'zero') return hold('a complete listing did not show the reserved email gone after the delete');
    const observedAt = new Date(now()).toISOString();
    if (left() < 0) return hold('the residue proof completed after the cleanup budget, so it is late');

    // 7. RECOVERED: the create journal validates the proof against the landed record.
    const residue = { lookupRef: sent.lookupRef, observedAt, queries: queries.map(({ kind, scope, count }) => ({ kind, scope, count })),
        residueChecks: queries.filter((q) => shared.has(q.store) && q.count === 0).length, residueNonZero: nonZero };
    try { recordAttemptRecovery(evidenceDir, admission.recordRunId, admission.attemptId, { kind: 'landed-and-cleaned', residue }, { at: observedAt }); }
    catch { return hold('the create journal did not accept the landed-and-cleaned proof'); }
    return { ...out, state: 'recovered', reason: 'the account was found, bound to this run and attempt, deleted on the scoped path, and every store read zero' };
}

module.exports = { BINDING_KEYS, RUN_OWNED_PREFIX, accountRefOf, j8ParentRecovery, sameBinding };
