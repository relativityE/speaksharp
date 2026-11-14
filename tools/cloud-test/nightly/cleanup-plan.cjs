"use strict";
// Nightly AHT suite: each journey's protected cleanup reserve, sized to the STRUCTURAL worst case of its cleanup
// steps (#1864 2a40e87 §6, Sam's #1865 review): every operation times its bounded attempts, never a measured average,
// because a cleanup that runs short leaves test data behind.
//
// The operations are the ones the existing cleanup code makes, read from it (a drift test in
// tests/cleanup.test.cjs fails if the code changes under these counts):
//   - deleting a run-owned account: tests/live/helpers/runOwnedCleanup.ts cleanupRunOwnedAccount;
//   - settling its stopped takes first: settleRunOwnedTakes (three reads of sessions + leases, one close per open take);
//   - the feedback fence of a case that writes feedback (AHT-01/02/07/08, #1859/#1860): close, clean, verify.
// Each operation is one attempt: the cleanup code fails closed rather than retrying.
//
// One step is deliberately NOT in the reserve: recovering an account's id by listing users (cleanupRunOwnedAccount
// polls up to 12 times over up to 50 pages, 600 requests and a minute of waiting) when the page never captured it. A
// nightly can't reserve that inside a job, so a run that has to do it stops cleanup there and records the account as
// left behind (cleanup-evidence.cjs); the next run is refused until the protected recovery route has removed it.
//
// Time: every cleanup request has its own deadline, CLEANUP_REQUEST_DEADLINE_S, which the harness handoff must enforce
// on each call (the repo's existing bound for a cleanup-side read, runAttemptsTerminal's AbortSignal.timeout(10_000)).
// A journey's time reserve is its requests times that deadline, so it is a ceiling, not an estimate.
const { JOURNEYS } = require('./journey-plan.cjs');

const CLEANUP_REQUEST_DEADLINE_S = 10;
/** Cases whose run writes feedback behind a fence (#1859, #1860): each needs its fence closed, cleaned and verified. */
const FENCED_CASES = Object.freeze(['AHT-01', 'AHT-02', 'AHT-07', 'AHT-08']);
/** The counts read from the cleanup code. tests/cleanup.test.cjs re-reads them from the source and fails on drift. */
const SOURCE_COUNTS = Object.freeze({
    residueChecks: 22, // RESIDUE_CHECKS entries
    preDeleteTables: 1, // PRE_DELETE_TABLES entries
    takeReadsPerSettlement: 3, // readTakes calls in settleRunOwnedTakes (first, fresh, final)
    requestsPerTakeRead: 2, // sessions + active_recording_lease
    fenceRpcs: 3, // close_rwt_feedback_fence_v1, clean_rwt_feedback_fence_v1, verify_rwt_feedback_fence_v1
});
/** One run-owned account's deletion, per attempt (1 each). `perOpenTake` scales with the takes the journey can open. */
const ACCOUNT_DELETION = Object.freeze([
    { op: 'read the account (getUserById)', requests: 1 },
    { op: 'settle stopped takes: reads', requests: SOURCE_COUNTS.takeReadsPerSettlement * SOURCE_COUNTS.requestsPerTakeRead },
    { op: 'settle stopped takes: close one open take', requests: 0, perOpenTake: 1 },
    { op: 'pre-delete tables', requests: SOURCE_COUNTS.preDeleteTables },
    { op: 'delete the account (deleteUser)', requests: 1 },
    { op: 'verify it is gone (getUserById)', requests: 1 },
    { op: 'residue reads', requests: SOURCE_COUNTS.residueChecks },
    { op: 'trial_entitlements residue read', requests: 1 },
].map(Object.freeze));
/**
 * Cleanup a journey can't have reserved yet because the step itself is not written: J2 opens a live Checkout Session,
 * and the reviewed step that expires it and settles the checkout operation does not exist (J2 stays gated off).
 */
const UNDEFINED_CLEANUP = Object.freeze({
    J2: 'expiring the Checkout Session and settling the checkout operation has no reviewed cleanup step yet',
});
class CleanupUndefined extends Error {}

/**
 * The structural worst case of one journey's cleanup: { requests, seconds, steps }. J9 reads a long-lived account and
 * deletes nothing, so its reserve is zero. A journey whose cleanup step is undefined throws: no allocation is guessed.
 */
function cleanupReserve(journeyId) {
    const j = JOURNEYS.find((x) => x.id === journeyId);
    if (!j)
        throw new Error(`unknown journey ${journeyId}`);
    if (UNDEFINED_CLEANUP[journeyId])
        throw new CleanupUndefined(`${journeyId}: ${UNDEFINED_CLEANUP[journeyId]}`);
    const steps = [];
    if (j.account === 'fresh-run-owned') {
        // Each Start press can open at most one take, so the journey's Start presses bound the takes left to close.
        const openTakes = j.legs.reduce((n, l) => n + l.startPresses, 0);
        for (const o of ACCOUNT_DELETION)
            steps.push({ op: o.op, requests: o.requests + (o.perOpenTake ?? 0) * openTakes });
    }
    const fenced = [...new Set(j.legs.map((l) => l.caseId).filter((c) => FENCED_CASES.includes(c)))];
    for (const c of fenced)
        steps.push({ op: `${c} feedback fence: close, clean, verify`, requests: SOURCE_COUNTS.fenceRpcs });
    const requests = steps.reduce((n, s) => n + s.requests, 0);
    return Object.freeze({ journey: journeyId, requests, seconds: requests * CLEANUP_REQUEST_DEADLINE_S, steps: Object.freeze(steps.map(Object.freeze)) });
}
/** Whole minutes for a reserve's seconds, rounded up (limits.cjs adds them per journey). */
const reserveMinutes = (r) => Math.ceil(r.seconds / 60);

module.exports = {
    ACCOUNT_DELETION, CLEANUP_REQUEST_DEADLINE_S, CleanupUndefined, FENCED_CASES, SOURCE_COUNTS, UNDEFINED_CLEANUP,
    cleanupReserve, reserveMinutes,
};
