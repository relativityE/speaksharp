"use strict";
// Nightly AHT suite: J8's ONE receipt (tests/live/rwt-feedback-association-boundaries.live.spec.ts, suite
// `feedback-association-boundaries-j8`) turned into the J8 invocation's case result, so case-results.cjs can split it per leg.
//
// Offline mapping only. It wires no adapter and satisfies no gate: J8 stays NOT RUN behind `no-j8-harness-adapter` until Sam's
// reviewed parent admission (the runner's admission record and its account-create attempt, recorded before signup) lands.
//
// Rules, all fail closed:
// - Every plan row of J8.a, J8.b and J8.c is emitted exactly once, naming the ONE leg it was observed on. A row is the worst of
//   the receipt steps it rests on; a step the receipt does not carry is HOLD, never PASS.
// - Leg-scoped steps (`J8.x: …`) prove only their own leg. A journey-wide step is used only where the property is one of the
//   whole journey (one account, one browser context), so it holds for every leg if it holds for the journey.
// - A plan row the receipt has no step for yet is a named GAP: HOLD with its reason, never borrowed from another leg.
// - A leg's `prerequisites` step decides whether the leg ran. FAIL: every row of the leg FAILs (a failed setup is a failure, never
//   hidden as NOT RUN). Anything else that is not PASS (HOLD, HUMAN, EXTERNAL): the leg was NOT RUN, so its rows are NOT RUN unless
//   one already FAILs.
// - Every receipt step the mapping does not consume floors the rows it could affect: a journey-wide one every leg, a leg-scoped one
//   that leg. FAIL floors to FAIL; anything else that is not PASS floors to HOLD. So a renamed, new or failed step is never ignored.
const { rowsForLeg } = require('./journey-plan.cjs');

const J8_SUITE = 'feedback-association-boundaries-j8';
const LEGS = Object.freeze(['J8.a', 'J8.b', 'J8.c']);
const RANK = Object.freeze({ PASS: 0, 'NOT RUN': 1, HOLD: 2, FAIL: 3 });
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);
/** Receipt verdicts: PASS and FAIL as written; HOLD, HUMAN (an open human observation) and EXTERNAL are all HOLD here. */
const receiptOutcome = (v) => (v === 'PASS' || v === 'FAIL' ? v : 'HOLD');

const J = (step) => Object.freeze({ scope: 'journey', step });
const L = (step) => Object.freeze({ scope: 'leg', step });
const GAP = (reason) => Object.freeze({ gap: reason });

const ACCOUNT = [J('run-owned signup'), J('canary claim in fresh login')];
const NO_CLOUD_STT = [J('no Cloud speech-to-text request')];
const PAGES_CLOSED = [J('owned pages closed')];
const FAULT_ROWS = (name) => ['fault exercised', 'alert copy truthful', 'dialog kept open', 'same key on Retry',
    'no fresh acknowledgement before the Retry', 'Retry treated as stored', 'exactly one stored row for the leg key']
    .map((s) => L(`feedback leg ${name}: ${s}`));
const NO_SESSION_SUBMIT = [L('fresh acknowledgment'), L('no-session report stored once'), L('no-session association'),
    L('no-session diagnostic binding'), L('received feedback')];

const J8A_START = GAP('the receipt has no J8.a-scoped Start-press count; the journey-wide count covers J8.b\'s two takes');
const J8B_ACK = GAP('the receipt has no J8.b-scoped fresh acknowledgment row for the older-take submit');
const J8B_RECEIVED = GAP('the receipt has no J8.b-scoped received feedback row (the finalizer writes it for J8.a and J8.c only)');

/** Each plan row: the receipt steps it rests on. Keys are the plan's own row names (`rowsForLeg`), checked at load. */
const MAP = Object.freeze({
    'J8.a': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [J8A_START],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'AHT-08:owner-bound': ACCOUNT,
        'AHT-08:fresh-acknowledgment': [L('fresh acknowledgment')],
        'AHT-08:feedback-stored-once': [L('no-session report stored once')],
        'AHT-08:no-session-association': [L('no-session association')],
        'AHT-08:no-coaching-association': [L('no-session diagnostic binding'), L('no coaching before any take')],
        'AHT-08:received-feedback-proof': [L('received feedback'), J('J8 leg readback bindings')],
        'AHT-08:start-press-budget': [J8A_START],
        'AHT-08:no-cloud-stt': NO_CLOUD_STT,
        'AHT-08:owned-pages-closed': PAGES_CLOSED,
    },
    'J8.b': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [J('Start presses within budget'), J8A_START],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'AHT-07:owner-bound': ACCOUNT,
        'AHT-07:fresh-acknowledgment': [J8B_ACK],
        'AHT-07:feedback-stored-once': [L('older-take report stored once')],
        'AHT-07:older-take-association': [L('two saved takes'), L('older-take association')],
        'AHT-07:older-coaching-association': [L('older take coaching request observed'), L('older-take diagnostic binding'),
            L('feedback diagnostic chain'), J('coaching request budget')],
        'AHT-07:received-feedback-proof': [J8B_RECEIVED, J('J8 leg readback bindings')],
        'AHT-07:feedback-failure-retry-form': [...FAULT_ROWS('synthetic 42501'), ...FAULT_ROWS('request lost'),
            ...FAULT_ROWS('stored response lost')],
        'AHT-07:feedback-transport-form-retry': FAULT_ROWS('request lost'),
        'AHT-07:feedback-rejection-form-retry': FAULT_ROWS('synthetic 42501'),
        'AHT-07:feedback-response-lost-form-retry': FAULT_ROWS('stored response lost'),
        'AHT-07:feedback-attempts': [L('feedback attempts within the cap'),
            L('feedback attempts are three faults, three Retries and one final submit'), L('final submit isolated from the fault legs'),
            J('feedback writer drained'), J('J8 write windows')],
        'AHT-07:feedback-readback-preflight': [J('feedback fence open')],
        'AHT-07:start-press-budget': [J('Start presses within budget'), J8A_START],
        'AHT-07:no-cloud-stt': NO_CLOUD_STT,
        'AHT-07:owned-pages-closed': PAGES_CLOSED,
    },
    'J8.c': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [L('no extra Start or coaching')],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'new:no-session-choice-with-takes': [...NO_SESSION_SUBMIT, L('both saved takes unchanged'), L('no extra Start or coaching'),
            J('J8 leg readback bindings')],
    },
});
for (const leg of LEGS) {
    const want = [...rowsForLeg(leg)].sort(), have = Object.keys(MAP[leg]).sort();
    if (JSON.stringify(want) !== JSON.stringify(have)) throw new Error(`J8 receipt mapping for ${leg} does not cover exactly its plan rows`);
}

/** The id case-results.cjs reads for a plan row: invariants and new rows by their bare name, catalog rows as `${home}:X`. */
const reportedId = (row) => (row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row);
const toResult = (o) => (o === 'NOT RUN' ? 'NOT_RUN' : o);

/**
 * The J8 invocation's case result from its receipt body. Throws on a receipt that is not J8's or is malformed (the runner then
 * records every J8 leg FAIL with the reason). Returns { caseId: 'J8', assertions: [{ id, leg, result, sources }], unmapped }.
 */
function mapJ8Receipt(receipt) {
    if (!receipt || typeof receipt !== 'object' || receipt.suite !== J8_SUITE)
        throw new Error(`expected the ${J8_SUITE} receipt, got ${receipt?.suite ?? 'nothing'}`);
    if (!Array.isArray(receipt.rows) || receipt.rows.length === 0) throw new Error('the J8 receipt has no rows');
    const steps = new Map();
    for (const r of receipt.rows) {
        if (!r || typeof r.step !== 'string' || !r.step || typeof r.verdict !== 'string') throw new Error('the J8 receipt has a malformed row');
        const o = receiptOutcome(r.verdict);
        steps.set(r.step, steps.has(r.step) ? worse(steps.get(r.step), o) : o);
    }
    const legOf = (step) => LEGS.find((l) => step.startsWith(`${l}: `)) ?? null;
    const stepName = (leg, s) => (s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
    const consumed = new Set(LEGS.map((l) => `${l}: prerequisites`));
    for (const leg of LEGS) for (const sources of Object.values(MAP[leg])) for (const s of sources) if (!s.gap) consumed.add(stepName(leg, s));
    // Unconsumed steps floor what they could affect: never ignored, never a PASS on their own.
    const floor = { journey: 'PASS', 'J8.a': 'PASS', 'J8.b': 'PASS', 'J8.c': 'PASS' };
    const unmapped = [];
    for (const [step, o] of steps) {
        if (consumed.has(step)) continue;
        unmapped.push({ step, outcome: o });
        if (o === 'PASS') continue;
        const key = legOf(step) ?? 'journey';
        floor[key] = worse(floor[key], o === 'FAIL' ? 'FAIL' : 'HOLD');
    }
    const assertions = [];
    for (const leg of LEGS) {
        const prerequisites = steps.has(`${leg}: prerequisites`) ? steps.get(`${leg}: prerequisites`) : 'PASS';
        for (const [row, sources] of Object.entries(MAP[leg])) {
            let outcome = 'PASS';
            const used = [];
            for (const s of sources) {
                if (s.gap) { outcome = worse(outcome, 'HOLD'); used.push(`GAP: ${s.gap}`); continue; }
                const name = stepName(leg, s);
                used.push(name);
                outcome = worse(outcome, steps.has(name) ? steps.get(name) : 'HOLD');
            }
            outcome = worse(worse(outcome, floor.journey), floor[leg]);
            if (prerequisites !== 'PASS') used.push(`${leg}: prerequisites`);
            // A failed setup fails the leg. A leg that never opened ran nothing: its rows are NOT RUN, unless something already FAILed.
            if (prerequisites === 'FAIL') outcome = 'FAIL';
            else if (prerequisites !== 'PASS' && outcome !== 'FAIL') outcome = 'NOT RUN';
            assertions.push({ id: reportedId(row), leg, result: toResult(outcome), sources: used });
        }
    }
    return { caseId: 'J8', assertions, unmapped };
}

module.exports = { J8_SUITE, J8_RECEIPT_MAP: MAP, mapJ8Receipt };
