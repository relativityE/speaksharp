"use strict";
// Nightly AHT suite: J8's ONE receipt (tests/live/rwt-feedback-association-boundaries.live.spec.ts, suite
// `feedback-association-boundaries-j8`) turned into the J8 invocation's case result, so case-results.cjs can split it per leg.
//
// The mapping satisfies no gate. In the nightly plan J8 stays NOT RUN behind `no-j8-harness-adapter`. The dedicated nightly entry
// (j8-nightly-entry.cjs, Sam: "a dedicated nightly entry, not an rc-gates step") records the account-create attempt before the
// signup, runs the spec, and reads its receipt and its independent readback through this mapping.
//
// Rules, all fail closed:
// - Every plan row of J8.a, J8.b and J8.c is emitted exactly once, naming the ONE leg it was observed on. A row is the worst of
//   the receipt steps it rests on; a step the receipt does not carry is HOLD, never PASS.
// - Leg-scoped steps (`J8.x: …`) prove only their own leg. A journey-wide step is used only where the property is one of the
//   whole journey (one account, one browser context), so it holds for every leg if it holds for the journey.
// - Every plan row rests on steps the receipt writes for that row's own leg (or for the whole journey); none is borrowed.
// - A leg's `prerequisites` step decides whether the leg ran. FAIL: every row of the leg FAILs (a failed setup is a failure, never
//   hidden as NOT RUN). Anything else that is not PASS (HOLD, HUMAN, EXTERNAL): the leg was NOT RUN, so its rows are NOT RUN unless
//   one already FAILs.
// - RECEIVED is never read from the browser (Sam: "the final submit's captured events prove sent, not received"). Each leg's
//   received row rests on the independent PostHog readback verdict of the ONE journey the receipt binds to that leg, and the
//   readback must be for this receipt's suite, release and exact bound journeys. J8.b's binding window starts at its final
//   submit and drops the fault-leg journeys, so none of the three fault attempts can be its received evidence. No readback,
//   or one that does not match, is HOLD.
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
/** The leg's received evidence: the independent readback verdict of the leg's one bound journey (never a receipt row). */
const READBACK = Object.freeze({ scope: 'readback', step: 'received feedback (independent readback)' });
const BINDINGS_ROW = 'J8 leg readback bindings';
const READBACK_STAGES = Object.freeze(['share_feedback']);

const ACCOUNT = [J('run-owned signup'), J('canary claim in fresh login')];
const NO_CLOUD_STT = [J('no Cloud speech-to-text request')];
const PAGES_CLOSED = [J('owned pages closed')];
const FAULT_ROWS = (name) => ['fault exercised', 'alert copy truthful', 'dialog kept open', 'same key on Retry',
    'no fresh acknowledgement before the Retry', 'Retry treated as stored', 'exactly one stored row for the leg key']
    .map((s) => L(`feedback leg ${name}: ${s}`));
const NO_SESSION_SUBMIT = [L('fresh acknowledgment'), L('no-session report stored once'), L('no-session association'),
    L('no-session diagnostic binding'), L('received feedback'), READBACK];

// The three former named gaps (Sam, #1926 merge tree), each now its own leg-scoped receipt row:
// - J8.a's own zero-Start observation (`J8.a: no Start press`, from the journey's start to the end of its submit);
// - J8.b's own Start presses (`J8.b: Start presses within budget`, its two takes against AHT-07's budget). The journey-wide
//   count alone cannot prove J8.b's: a press in J8.a would hide a missing one in J8.b;
// - J8.b's fresh acknowledgment and its final older-take pair (`J8.b: final feedback pair sent`, Sam's d25925d0). That row is
//   SENT only; J8.b's received row also needs the independent readback of the final submit's own journey (READBACK).
const J8A_NO_START = L('no Start press');
const J8B_OWN_STARTS = L('Start presses within budget');

/** Each plan row: the receipt steps it rests on. Keys are the plan's own row names (`rowsForLeg`), checked at load. */
const MAP = Object.freeze({
    'J8.a': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [J8A_NO_START],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'AHT-08:owner-bound': ACCOUNT,
        'AHT-08:fresh-acknowledgment': [L('fresh acknowledgment')],
        'AHT-08:feedback-stored-once': [L('no-session report stored once')],
        'AHT-08:no-session-association': [L('no-session association')],
        'AHT-08:no-coaching-association': [L('no-session diagnostic binding'), L('no coaching before any take')],
        'AHT-08:received-feedback-proof': [L('received feedback'), J(BINDINGS_ROW), READBACK],
        'AHT-08:start-press-budget': [J8A_NO_START],
        'AHT-08:no-cloud-stt': NO_CLOUD_STT,
        'AHT-08:owned-pages-closed': PAGES_CLOSED,
    },
    'J8.b': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [J8B_OWN_STARTS, J('Start presses within budget')],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'AHT-07:owner-bound': ACCOUNT,
        'AHT-07:fresh-acknowledgment': [L('fresh acknowledgment')],
        'AHT-07:feedback-stored-once': [L('older-take report stored once')],
        'AHT-07:older-take-association': [L('two saved takes'), L('older-take association')],
        'AHT-07:older-coaching-association': [L('older take coaching request observed'), L('older-take diagnostic binding'),
            L('feedback diagnostic chain'), J('coaching request budget')],
        'AHT-07:received-feedback-proof': [L('final feedback pair sent'), L('final submit isolated from the fault legs'), J(BINDINGS_ROW),
            READBACK],
        'AHT-07:feedback-failure-retry-form': [...FAULT_ROWS('synthetic 42501'), ...FAULT_ROWS('request lost'),
            ...FAULT_ROWS('stored response lost')],
        'AHT-07:feedback-transport-form-retry': FAULT_ROWS('request lost'),
        'AHT-07:feedback-rejection-form-retry': FAULT_ROWS('synthetic 42501'),
        'AHT-07:feedback-response-lost-form-retry': FAULT_ROWS('stored response lost'),
        'AHT-07:feedback-attempts': [L('feedback attempts within the cap'),
            L('feedback attempts are three faults, three Retries and one final submit'), L('final submit isolated from the fault legs'),
            J('feedback writer drained'), J('J8 write windows')],
        'AHT-07:feedback-readback-preflight': [J('feedback fence open')],
        'AHT-07:start-press-budget': [J8B_OWN_STARTS, J('Start presses within budget')],
        'AHT-07:no-cloud-stt': NO_CLOUD_STT,
        'AHT-07:owned-pages-closed': PAGES_CLOSED,
    },
    'J8.c': {
        'invariant:owner-bound': ACCOUNT,
        'invariant:start-press-budget': [L('no extra Start or coaching')],
        'invariant:no-cloud-stt': NO_CLOUD_STT,
        'invariant:owned-pages-closed': PAGES_CLOSED,
        'new:no-session-choice-with-takes': [...NO_SESSION_SUBMIT, L('both saved takes unchanged'), L('no extra Start or coaching'),
            J(BINDINGS_ROW)],
    },
});
for (const leg of LEGS) {
    const want = [...rowsForLeg(leg)].sort(), have = Object.keys(MAP[leg]).sort();
    if (JSON.stringify(want) !== JSON.stringify(have)) throw new Error(`J8 receipt mapping for ${leg} does not cover exactly its plan rows`);
}

/** The id case-results.cjs reads for a plan row: invariants and new rows by their bare name, catalog rows as `${home}:X`. */
const reportedId = (row) => (row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row);
const toResult = (o) => (o === 'NOT RUN' ? 'NOT_RUN' : o);

const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const readbackStages = (j) => (Array.isArray(j?.stages) ? j.stages.map(String) : null);

/**
 * Each leg's received outcome from the independent readback (rc-gates' readback-verdicts shape: { suite, release, journeys:
 * [{ journeyId, stages, verdict }], missingBindings }). PASS only when the readback is this receipt's (suite, release, and exactly
 * the receipt's bound journeys and stages) and the leg's ONE bound journey (the receipt's own `J8 leg readback bindings`, PASS)
 * declares exactly `share_feedback` and QUALIFIED. An observed received FAIL is FAIL. Anything else is HOLD.
 */
function readbackOutcomes(receipt, readback) {
    const hold = (why) => Object.fromEntries(LEGS.map((l) => [l, { outcome: 'HOLD', why }]));
    if (readback === undefined || readback === null) return hold('no independent readback');
    if (typeof readback !== 'object' || Array.isArray(readback) || !Array.isArray(readback.journeys) || !Array.isArray(readback.missingBindings))
        return hold('the readback is malformed');
    if (readback.suite !== J8_SUITE || typeof receipt.release !== 'string' || readback.release !== receipt.release)
        return hold('the readback is not for this receipt\'s suite and release');
    // Sam on b1f8323f (3): the readback carries its own run, attempt and create-attempt binding, and it must be this receipt's.
    const b = readback.binding;
    if (!b || typeof b !== 'object' || typeof receipt.meta?.runnerAttempt !== 'string' || b.createAttempt !== receipt.meta.runnerAttempt
        || typeof b.runId !== 'string' || !b.runId || typeof b.runAttempt !== 'string' || !b.runAttempt)
        return hold('the readback is not bound to this receipt\'s run and create attempt');
    const bound = Array.isArray(receipt.readback?.journeys) ? receipt.readback.journeys : null;
    if (!bound) return hold('the receipt binds no readback journeys');
    const key = (j) => `${String(j?.journeyId)}=${(readbackStages(j) ?? ['?']).join(',')}`;
    if (!sameSet(bound.map(key), readback.journeys.map(key))) return hold('the readback does not cover exactly the receipt\'s bound journeys');
    const bindings = receipt.rows.find((r) => r && r.step === BINDINGS_ROW);
    const legIds = Object.fromEntries(LEGS.map((leg) => [leg, String(bindings?.evidence?.[leg] ?? '').split(',').filter(Boolean)]));
    const all = LEGS.flatMap((leg) => legIds[leg]);
    if (new Set(all).size !== all.length) return hold('one journey is bound to more than one leg');
    const out = {};
    for (const leg of LEGS) {
        const ids = legIds[leg];
        if (!bindings || bindings.verdict !== 'PASS' || ids.length !== 1) { out[leg] = { outcome: 'HOLD', why: 'the leg has no single bound journey' }; continue; }
        const mine = readback.journeys.filter((j) => j && j.journeyId === ids[0]);
        const declared = bound.filter((j) => j && j.journeyId === ids[0]);
        if (mine.length !== 1 || declared.length !== 1 || !sameSet(readbackStages(mine[0]) ?? [], READBACK_STAGES)
            || !sameSet(readbackStages(declared[0]) ?? [], READBACK_STAGES)) {
            out[leg] = { outcome: 'HOLD', why: 'the leg\'s journey is not bound once to its feedback stage' };
            continue;
        }
        // A received verdict must carry what the readback CLI itself checked: this journey on this release.
        const v = mine[0].verdict;
        const got = mine[0].received;
        if ((v === 'QUALIFIED' || v === 'FAIL') && (!got || got.journey_id !== ids[0] || got.release_sha !== receipt.release)) {
            out[leg] = { outcome: 'HOLD', why: 'the readback verdict carries no evidence of this journey on this release' };
            continue;
        }
        // J8.b is received only for the final submit's own journey (its window starts at the final submit's click).
        if (leg === 'J8.b' && v === 'QUALIFIED' && readback.finalSubmit?.journeyId !== ids[0]) {
            out[leg] = { outcome: 'HOLD', why: 'the readback is not bound to the final submit\'s journey' };
            continue;
        }
        out[leg] = v === 'QUALIFIED' ? { outcome: 'PASS', why: 'received' } : v === 'FAIL' ? { outcome: 'FAIL', why: 'readback observed a received failure' }
            : { outcome: 'HOLD', why: 'the readback did not qualify the leg\'s journey' };
    }
    return out;
}

/**
 * The J8 invocation's case result from its receipt body. Throws on a receipt that is not J8's or is malformed (the runner then
 * records every J8 leg FAIL with the reason). Returns { caseId: 'J8', assertions: [{ id, leg, result, sources }], unmapped }.
 */
function mapJ8Receipt(receipt, readback) {
    if (!receipt || typeof receipt !== 'object' || receipt.suite !== J8_SUITE)
        throw new Error(`expected the ${J8_SUITE} receipt, got ${receipt?.suite ?? 'nothing'}`);
    if (!Array.isArray(receipt.rows) || receipt.rows.length === 0) throw new Error('the J8 receipt has no rows');
    const steps = new Map();
    const received = readbackOutcomes(receipt, readback);
    for (const r of receipt.rows) {
        if (!r || typeof r.step !== 'string' || !r.step || typeof r.verdict !== 'string') throw new Error('the J8 receipt has a malformed row');
        const o = receiptOutcome(r.verdict);
        steps.set(r.step, steps.has(r.step) ? worse(steps.get(r.step), o) : o);
    }
    const legOf = (step) => LEGS.find((l) => step.startsWith(`${l}: `)) ?? null;
    const stepName = (leg, s) => (s.scope === 'journey' ? s.step : `${leg}: ${s.step}`);
    // A receipt row can never stand in for the readback: the readback outcome is read from `received`, not from `steps`.
    const sourceOutcome = (leg, s) => (s.scope === 'readback' ? received[leg].outcome : steps.has(stepName(leg, s)) ? steps.get(stepName(leg, s)) : 'HOLD');
    const consumed = new Set(LEGS.map((l) => `${l}: prerequisites`));
    for (const leg of LEGS) for (const sources of Object.values(MAP[leg])) for (const s of sources) if (s.scope !== 'readback') consumed.add(stepName(leg, s));
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
                used.push(s.scope === 'readback' ? `${stepName(leg, s)}: ${received[leg].why}` : stepName(leg, s));
                outcome = worse(outcome, sourceOutcome(leg, s));
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
