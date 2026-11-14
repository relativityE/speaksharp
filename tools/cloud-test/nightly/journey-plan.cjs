"use strict";
// Nightly AHT suite: the nine journeys (J1 to J9) of the #1864 design, their legs, and the home of every row.
//
// This file is the suite's single plan. Every one of the 204 catalog rows in
// tools/cloud-test/config/assertion-catalog.json has exactly one entry in CATALOG_ROW_HOMES (the coverage drift
// test in nightly/tests/journey-plan.test.cjs fails otherwise), and every new row of the design is in NEW_ROWS.
// The row homes are copied from #1864's coverage-map.v1.json (checked against head 2c72705: all 204 homes and the 19 new rows match). Nothing here edits or replaces the
// existing live cases: those 204 rows stay live until each replacement is independently proven.
const JOURNEY_IDS = Object.freeze(['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9']);
/** The four invariants asserted in every leg (design §1). */
const LEG_INVARIANTS = Object.freeze(['owner-bound', 'start-press-budget', 'no-cloud-stt', 'owned-pages-closed']);
const CANARY_GATE = Object.freeze({
    kind: 'canary-claim-ack', outcome: 'NOT RUN',
    reason: 'ending the trial needs RWT_CANARY_CLAIM_ACK and the server-issued canary claim on the run-owned account',
});
// Where each leg runs in the existing harness (tools/cloud-test/harness/draft-adapters/AHT-NN.cjs) and how many
// Start presses it spends there. A leg with caseId null has no harness case yet: its adapter is part of the
// exact-file harness handoff (in the description of #1865), and until it lands the leg reports NOT RUN.
// The Start presses sum to 43: the 42 of the catalog's cases plus J1.c's short Stop.
const HARNESS_CASES = Object.freeze({
    'J1.a': ['AHT-01', 4], 'J1.b': ['AHT-01', 0], 'J1.c': ['AHT-01', 1], 'J1.d': ['AHT-15', 0],
    'J1.e': [null, 0], 'J1.f': [null, 0], 'J2': [null, 0],
    'J3.a': ['AHT-02', 7], 'J3.b': ['AHT-03', 4], 'J4.a': ['AHT-05', 2], 'J4.b': ['AHT-06', 2],
    'J5.a': ['AHT-04', 2], 'J5.b': ['AHT-09', 3], 'J5.c': ['AHT-10', 3], 'J6': ['AHT-11', 4],
    'J7.a': ['AHT-12', 3], 'J7.b': ['AHT-13', 3], 'J7.c': ['AHT-14', 3], 'J7.d': [null, 0],
    'J8.a': ['AHT-08', 0], 'J8.b': ['AHT-07', 2], 'J8.c': [null, 0], 'J9.a': [null, 0], 'J9.b': [null, 0],
});
const NO_HARNESS_CASE = Object.freeze({
    kind: 'no-harness-case', outcome: 'NOT RUN',
    reason: 'this leg has no harness adapter yet; it lands through the reviewed harness handoff',
});
const harnessCase = (id) => {
    const entry = HARNESS_CASES[id];
    if (!entry)
        throw new Error(`leg ${id} has no harness mapping`);
    return entry;
};
const leg = (id, story, o = {}) => Object.freeze({
    id, journey: id.slice(0, 2), story,
    caseId: harnessCase(id)[0], startPresses: harnessCase(id)[1],
    needs: Object.freeze(o.needs ?? []), context: o.context ?? 'shared', needsCoaching: o.needsCoaching ?? (o.coachingRequests ?? 0) > 0,
    coachingRequests: o.coachingRequests ?? 0, coachingProbes: o.coachingProbes ?? 0,
    // What the run budget reserves for the leg before the run starts: one per saved take's review, plus the worst case of
    // every probe the server should refuse (Sam's #1864 review: reserve the probe's cost before it is sent).
    coachingReserve: (o.coachingRequests ?? 0) + (o.coachingProbes ?? 0), proofScope: o.proofScope ?? 'deployed-production',
    gates: Object.freeze([...(o.gates ?? []), ...(harnessCase(id)[0] === null ? [NO_HARNESS_CASE] : [])]),
});
const JOURNEYS = Object.freeze([
    {
        id: 'J1', title: "New user's first 30 days", account: 'fresh-run-owned', coachingMax: 5,
        legs: [
            leg('J1.a', 'sign up, trial length, first Open Mic take', { coachingRequests: 4 }),
            leg('J1.b', 'coaching, review, PDF, same-target repeat', { needs: ['J1.a'], needsCoaching: true, coachingRequests: 0 }),
            leg('J1.c', 'short Stop saves nothing; probe save isolation', { needs: ['J1.a'], needsCoaching: true, coachingRequests: 0 }),
            leg('J1.d', 'sign out and return, deep link, history preserved', { needs: ['J1.a'] }),
            // J1.e sends one coaching request with the expired account's token, which the server must refuse before any
            // provider work. If it wrongly accepts it, that request costs up to 3 provider calls, so the run reserves it
            // up front (Sam, #1864 review) instead of leaving it outside the ceiling.
            leg('J1.e', 'trial ends: wall on the open session, then after a fresh sign-in; server refuses', { gates: [CANARY_GATE], coachingProbes: 1 }),
            leg('J1.f', 'delete the account from the wall', { needs: ['J1.e'], gates: [CANARY_GATE] }),
        ],
    },
    {
        id: 'J2', title: 'Hitting the wall and going to pay', account: 'fresh-run-owned', coachingMax: 0,
        legs: [
            leg('J2', 'expired account, wall, hosted Checkout opens, abandon, still walled; webhook configured', {
                gates: [CANARY_GATE, {
                        kind: 'disabled-until-reviewed', outcome: 'NOT RUN',
                        reason: 'opening Checkout on production stays disabled until a reviewed cleanup expires the session and settles the checkout operation',
                    }],
            }),
        ],
    },
    {
        id: 'J3', title: 'Focus practice', account: 'fresh-run-owned', coachingMax: 11,
        legs: [
            leg('J3.a', 'full Focus fixture', { coachingRequests: 7 }),
            leg('J3.b', 'partial Focus fixture with one repeat take', { coachingRequests: 4 }),
        ],
    },
    {
        id: 'J4', title: 'Save under a bad connection', account: 'fresh-run-owned', coachingMax: 4,
        legs: [
            leg('J4.a', 'save request lost, retry, one saved', { coachingRequests: 2 }),
            leg('J4.b', 'save response lost, retry, one saved; next take isolated', { coachingRequests: 2 }),
        ],
    },
    {
        id: 'J5', title: 'Leaving mid-flow', account: 'fresh-run-owned', coachingMax: 5,
        legs: [
            leg('J5.a', 'leave during a cold Start', { context: 'fresh-cold-context', coachingRequests: 1 }),
            leg('J5.b', 'navigate away while recording', { coachingRequests: 2 }),
            leg('J5.c', 'close the tab while recording, return', { coachingRequests: 2 }),
        ],
    },
    {
        id: 'J6', title: 'Two places at once', account: 'fresh-run-owned', coachingMax: 2,
        legs: [leg('J6', 'second tab and second browser refused; takeover fences the old owner', { context: 'two-contexts', coachingRequests: 2 })],
    },
    {
        id: 'J7', title: 'First-time setup goes wrong, then leaving', account: 'fresh-run-owned', coachingMax: 3,
        legs: [
            leg('J7.a', 'mic denied then granted in the same deny-launched browser', {
                context: 'deny-launched-browser', coachingRequests: 1,
                gates: [{ kind: 'unqualified', outcome: 'HOLD', reason: 'granting the microphone inside a deny-launched browser is not yet qualified' }],
            }),
            leg('J7.b', 'model request fails before any byte, retry', { context: 'fresh-cold-context', coachingRequests: 1 }),
            leg('J7.c', 'connection drops after bytes arrive, retry', { context: 'fresh-cold-context', coachingRequests: 1 }),
            leg('J7.d', 'delete the account from the Account page during the trial'),
        ],
    },
    {
        id: 'J8', title: 'Telling us something', account: 'fresh-run-owned', coachingMax: 2,
        legs: [
            leg('J8.a', 'feedback with no session, before any take'),
            leg('J8.b', 'feedback on an older take and its coaching, with retries', { coachingRequests: 2 }),
            leg('J8.c', '"No session" chosen while takes are listed', { needs: ['J8.b'] }),
        ],
    },
    {
        id: 'J9', title: 'Existing paying customer after an upgrade', account: 'long-lived-paid-read-only', coachingMax: 0,
        legs: [
            // No test account is ever charged for real (Akin, 14 Nov). J9.a's account pays once, through the product, with
            // a Stripe test-mode card on the persistent billing sandbox. Its PASS is labelled sandbox, never production proof.
            leg('J9.a', 'sandbox: kept sessions, Progress and the billing portal open on a long-lived test-mode paid account; no takes', {
                proofScope: 'stripe-test-mode-sandbox',
                gates: [{ kind: 'test-mode-fixture', outcome: 'NOT RUN', reason: 'J9.a pays with a Stripe test-mode card on the billing sandbox, and that sandbox is not runnable yet' }],
            }),
            // NOT RUN on every run by design: a sandbox result never stands in for it.
            leg('J9.b', 'production: a real paid account keeps its entitlement and data after a production upgrade', {
                gates: [{ kind: 'no-safe-production-proof', outcome: 'NOT RUN', reason: 'NOT RUN by design: there is no safe, approved way to hold a paid account on production, and no test account is ever charged for real' }],
            }),
        ],
    },
].map((j) => {
    // The journey maxima are the design's §6 table plus J1.e's probe reserve; they must equal the sum of the legs' reserves.
    const sum = j.legs.reduce((n, l) => n + l.coachingReserve, 0);
    if (sum !== j.coachingMax)
        throw new Error(`${j.id}: legs send ${sum} coaching requests, the journey allows ${j.coachingMax}`);
    return Object.freeze({ ...j, legs: Object.freeze(j.legs) });
}));
/** The ceiling with every leg runnable: the sum of the journeys' maxima (32: the design's 31 takes plus J1.e's probe). */
const DESIGN_RUN_COACHING_CAP = JOURNEYS.reduce((n, j) => n + j.coachingMax, 0);
/** Start presses with every leg runnable: 43. */
const DESIGN_RUN_START_PRESSES = JOURNEYS.reduce((n, j) => n + j.legs.reduce((m, l) => m + l.startPresses, 0), 0);
const ALL_LEGS = Object.freeze(JOURNEYS.flatMap((j) => j.legs));
function legById(id) {
    const found = ALL_LEGS.find((l) => l.id === id);
    if (!found)
        throw new Error(`unknown nightly leg ${id}`);
    return found;
}
/** The design's nineteen new rows (§2 of #1864; unchanged from 098f0ae to 2c72705). */
const NEW_ROWS = Object.freeze([
    { leg: 'J1.a', assertion: 'trial-length-thirty-days' },
    { leg: 'J1.c', assertion: 'short-stop-no-save' },
    { leg: 'J1.d', assertion: 'signout-no-unauthorized-read' },
    { leg: 'J1.d', assertion: 'signout-no-stale-request' },
    { leg: 'J1.e', assertion: 'trial-expired-wall-on-open-session' },
    { leg: 'J1.e', assertion: 'trial-expired-payment-wall' },
    { leg: 'J1.e', assertion: 'trial-expired-server-refuses' },
    { leg: 'J1.f', assertion: 'account-delete-from-wall' },
    { leg: 'J2', assertion: 'paid-wall-before-payment' },
    { leg: 'J2', assertion: 'checkout-opens-for-expired-user' },
    { leg: 'J2', assertion: 'abandoned-checkout-stays-walled' },
    { leg: 'J2', assertion: 'deployed-webhook-ready' },
    { leg: 'J7.d', assertion: 'account-delete-during-trial' },
    { leg: 'J8.c', assertion: 'no-session-choice-with-takes' },
    { leg: 'J9.a', assertion: 'pre-upgrade-history-opens' },
    { leg: 'J9.a', assertion: 'pre-upgrade-progress-opens' },
    { leg: 'J9.a', assertion: 'old-sessions-no-new-coaching' },
    { leg: 'J9.a', assertion: 'entitlement-survives-upgrade' },
    { leg: 'J9.b', assertion: 'production-entitlement-after-upgrade' },
].map((r) => Object.freeze(r)));
/** Every row a leg must report: the catalog rows homed there, the new rows homed there, and the four invariants. */
function rowsForLeg(legId) {
    legById(legId);
    const homed = CATALOG_ROW_HOMES.filter((r) => r.legs.includes(legId)).map((r) => `${r.caseId}:${r.assertion}`);
    const added = NEW_ROWS.filter((r) => r.leg === legId).map((r) => `new:${r.assertion}`);
    const inv = LEG_INVARIANTS.map((a) => `invariant:${a}`);
    return Object.freeze([...new Set([...inv, ...homed, ...added])]);
}
const CATALOG_ROW_HOMES = Object.freeze([
    { caseId: 'AHT-01', assertion: 'owner-bound', legs: ['J1.a', 'J1.b', 'J1.c'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'fresh-first-session', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'saved-once', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'grounded-coaching', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'review-reopen', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'pdf-owner-take', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'same-target-repeat', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'analytics-repeat-opens-product', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'rapid-repeat-gate', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'rapid-repeat-release', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'next-start', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'next-start-release', legs: ['J1.b'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'probe-save-isolation', legs: ['J1.c'], change: 'strengthened' },
    { caseId: 'AHT-01', assertion: 'same-target-numeric', legs: ['J1.b'], change: 'strengthened' },
    { caseId: 'AHT-01', assertion: 'open-mic-review-presentation', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'open-mic-coaching-length', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'open-mic-coaching-distinct', legs: ['J1.a'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'start-press-budget', legs: ['J1.a', 'J1.b', 'J1.c'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'no-cloud-stt', legs: ['J1.a', 'J1.b', 'J1.c'], change: 'kept' },
    { caseId: 'AHT-01', assertion: 'owned-pages-closed', legs: ['J1.a', 'J1.b', 'J1.c'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'owner-bound', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-final', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-live-durable', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'saved-once', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'grounded-coaching', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'review-reopen', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'same-target-repeat', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-edit-cancel-save', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-new-set', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'open-mic-isolation', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-back-reload', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'analytics-repeat-opens-product', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'rapid-repeat-gate', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'rapid-repeat-release', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'next-start', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'next-start-release', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'probe-save-isolation', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'same-target-numeric', legs: ['J3.a'], change: 'strengthened' },
    { caseId: 'AHT-02', assertion: 'focus-switch-isolation', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-presentation-contract', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-pace-guide', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-rail-before', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-rail-legend', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-pending-labelled', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-next-point-marked', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-no-red-before-stop', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-not-detected-explained', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-coverage-count', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-average-per-point', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'focus-final-rail-colours-words', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'start-press-budget', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'no-cloud-stt', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-02', assertion: 'owned-pages-closed', legs: ['J3.a'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'owner-bound', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-final', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-live-durable', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'saved-once', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'grounded-coaching', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'review-reopen', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'same-target-repeat', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'analytics-repeat-opens-product', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'rapid-repeat-gate', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'rapid-repeat-release', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'next-start', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'next-start-release', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'probe-save-isolation', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'same-target-numeric', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-back-reload', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-presentation-contract', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-pace-guide', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-rail-before', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-rail-legend', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-pending-labelled', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-next-point-marked', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-no-red-before-stop', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-not-detected-explained', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-coverage-count', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-average-per-point', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'focus-final-rail-colours-words', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'start-press-budget', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'no-cloud-stt', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-03', assertion: 'owned-pages-closed', legs: ['J3.b'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'owner-bound', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'cold-pending-observed', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'pending-leave-no-mic', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'pending-leave-no-session', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'return-no-resume', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'deliberate-recovery-saved', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'start-press-budget', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'no-cloud-stt', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-04', assertion: 'owned-pages-closed', legs: ['J5.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'owner-bound', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'fault-exercised', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'recovery-truthful', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'retry-saved-once', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'review-reopen', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'next-take-isolated', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'completion-attempts', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'start-press-budget', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'no-cloud-stt', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-05', assertion: 'owned-pages-closed', legs: ['J4.a'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'owner-bound', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'fault-exercised', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'recovery-truthful', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'retry-saved-once', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'review-reopen', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'next-take-isolated', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'completion-attempts', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'start-press-budget', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'no-cloud-stt', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-06', assertion: 'owned-pages-closed', legs: ['J4.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'owner-bound', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'fresh-acknowledgment', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-stored-once', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'older-take-association', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'older-coaching-association', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'received-feedback-proof', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-failure-retry-form', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-transport-form-retry', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-rejection-form-retry', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-response-lost-form-retry', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-attempts', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'feedback-readback-preflight', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'start-press-budget', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'no-cloud-stt', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-07', assertion: 'owned-pages-closed', legs: ['J8.b'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'owner-bound', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'fresh-acknowledgment', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'feedback-stored-once', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'no-session-association', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'no-coaching-association', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'received-feedback-proof', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'start-press-budget', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'no-cloud-stt', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-08', assertion: 'owned-pages-closed', legs: ['J8.a'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'owner-bound', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'recording-before-leave', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'leave-released', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'return-no-resume', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'recovery-truthful', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'left-take-saved-once', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'next-take-isolated', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'lease-fenced', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'start-press-budget', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'no-cloud-stt', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'owned-pages-closed', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-09', assertion: 'navigation-ready', legs: ['J5.b'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'owner-bound', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'recording-before-leave', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'leave-released', legs: ['J5.c'], change: 'strengthened' },
    { caseId: 'AHT-10', assertion: 'return-no-resume', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'recovery-truthful', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'next-take-isolated', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'lease-fenced', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'start-press-budget', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'no-cloud-stt', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-10', assertion: 'owned-pages-closed', legs: ['J5.c'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'owner-bound', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'same-browser-refused', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'independent-context-refused', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'lease-before-model-window', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'takeover-fences-old-owner', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'two-takes-isolated', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'start-press-budget', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'no-cloud-stt', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-11', assertion: 'owned-pages-closed', legs: ['J6'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'owner-bound', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'press-bound-denial', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'denial-truthful-no-mic', legs: ['J7.a'], change: 'strengthened' },
    { caseId: 'AHT-12', assertion: 'allowed-recovery-saved', legs: ['J7.a'], change: 'strengthened' },
    { caseId: 'AHT-12', assertion: 'review-reopen', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'start-press-budget', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'no-cloud-stt', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-12', assertion: 'owned-pages-closed', legs: ['J7.a'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'owner-bound', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'download-fault-exercised', legs: ['J7.b'], change: 'strengthened' },
    { caseId: 'AHT-13', assertion: 'download-failure-truthful', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'deliberate-recovery-saved', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'review-reopen', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'start-press-budget', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'no-cloud-stt', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-13', assertion: 'owned-pages-closed', legs: ['J7.b'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'owner-bound', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'download-fault-exercised', legs: ['J7.c'], change: 'strengthened' },
    { caseId: 'AHT-14', assertion: 'download-failure-truthful', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'deliberate-recovery-saved', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'review-reopen', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'start-press-budget', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'no-cloud-stt', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-14', assertion: 'owned-pages-closed', legs: ['J7.c'], change: 'kept' },
    { caseId: 'AHT-15', assertion: 'owner-bound', legs: ['J1.d'], change: 'kept' },
    { caseId: 'AHT-15', assertion: 'history-preserved', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'switches-mic-off', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'signed-out', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'return-owner-preserved', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'no-recording-or-session-write', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'start-press-budget', legs: ['J1.d'], change: 'kept' },
    { caseId: 'AHT-15', assertion: 'no-cloud-stt', legs: ['J1.d'], change: 'kept' },
    { caseId: 'AHT-15', assertion: 'owned-pages-closed', legs: ['J1.d'], change: 'kept' },
    { caseId: 'AHT-15', assertion: 'return-entry-mic-off', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'deep-link-exact-return', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'deep-link-rendered-own-detail', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'deep-link-mic-off', legs: ['J1.d'], change: 'moved' },
    { caseId: 'AHT-15', assertion: 'return-signed-out', legs: ['J1.d'], change: 'moved' },
]);

module.exports = { ALL_LEGS, DESIGN_RUN_START_PRESSES, HARNESS_CASES, NO_HARNESS_CASE, CATALOG_ROW_HOMES, DESIGN_RUN_COACHING_CAP, JOURNEYS, JOURNEY_IDS, LEG_INVARIANTS, NEW_ROWS, legById, rowsForLeg };
