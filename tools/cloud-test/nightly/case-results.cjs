"use strict";
// Nightly AHT suite: turn one harness case result into the results of the legs that case covers.
//
// A harness case (tools/cloud-test/harness/draft-adapters/AHT-NN.cjs, through source-adapters.cjs run()) returns
// { caseId, assertions: [{ id, result }], blocker, executionSignals }. One case can cover several legs (AHT-01 covers
// J1.a, J1.b and J1.c). Each case row lands on the legs the plan homes it to:
// - a catalog row `X` homed to a leg becomes `${caseId}:X` there;
// - a row named after one of the four invariants also fills `invariant:X` on every leg of that case;
// - a row named after a new row of the design becomes `new:X` on that new row's leg (once the handoff adds it).
// A row the plan places nowhere is not dropped: it lands as `unplaced:X` on every leg of the case, which legVerdict
// fails as a row outside the plan, so a renamed or missing row can never pass silently. A Start press the harness
// stopped at its cap fails start-press-budget on every leg of the case.
// A journey invocation (J8) reports a catalog row as `${home}:X` for the legacy case it is homed by (AHT-07 and AHT-08 share
// row names), so each lands only on its own leg; its plain rows are invariants or new rows as for a case.
const { ALL_LEGS, CATALOG_ROW_HOMES, JOURNEY_INVOCATIONS, LEG_INVARIANTS, NEW_ROWS, isInvocation } = require('./journey-plan.cjs');
const OUTCOMES = new Set(['PASS', 'FAIL', 'NOT RUN', 'HOLD']);
/** The harness writes NOT_RUN in some error paths; anything else unknown is a FAIL, never a PASS. */
function outcomeOf(result) {
    if (result === 'NOT_RUN')
        return 'NOT RUN';
    return OUTCOMES.has(result) ? result : 'FAIL';
}
/** The legs one harness case covers, in plan order. */
function legsForCase(caseId) {
    return ALL_LEGS.filter((l) => l.caseId === caseId).map((l) => l.id);
}
/** A legacy AHT-NN case row: catalog home by this case, invariant on every leg of the case, or a new row. */
function placeCaseRow(caseId, legs, a, put) {
    const id = String(a?.id ?? '');
    const outcome = outcomeOf(a?.result);
    let placed = false;
    for (const home of CATALOG_ROW_HOMES) {
        if (home.caseId !== caseId || home.assertion !== id)
            continue;
        for (const leg of home.legs)
            put(leg, `${caseId}:${id}`, outcome);
        placed = true;
    }
    if (LEG_INVARIANTS.includes(id)) {
        for (const leg of legs)
            put(leg, `invariant:${id}`, outcome);
        placed = true;
    }
    for (const n of NEW_ROWS) {
        if (n.assertion === id && legs.includes(n.leg)) {
            put(n.leg, `new:${id}`, outcome);
            placed = true;
        }
    }
    if (!placed)
        for (const leg of legs)
            put(leg, `unplaced:${id || '(no id)'}`, outcome);
}
/**
 * A journey-invocation row (Sam, #1870): AHT-07/AHT-08 are historical row IDs only, never a receipt source. Every row names
 * the ONE leg it was observed on (`leg`), and lands only there: a catalog row as `${home}:X` when the plan homes `${home}:X`
 * on that leg, an invariant on that leg alone, a new row on its own leg. A row naming no leg of this invocation, or a row
 * claimed for a leg the plan homes it elsewhere (swapped between legs), is `unplaced` on every leg: never a PASS.
 */
function placeInvocationRow(caseId, legs, a, put) {
    const id = String(a?.id ?? '');
    const outcome = outcomeOf(a?.result);
    const leg = typeof a?.leg === 'string' && legs.includes(a.leg) ? a.leg : null;
    const unplaced = () => { for (const l of legs) put(l, `unplaced:${leg ?? '(no leg)'}:${id || '(no id)'}`, outcome); };
    if (leg === null)
        return unplaced();
    const { homes } = JOURNEY_INVOCATIONS[caseId];
    const home = CATALOG_ROW_HOMES.find((h) => homes.includes(h.caseId) && `${h.caseId}:${h.assertion}` === id);
    if (home)
        return home.legs.includes(leg) ? put(leg, id, outcome) : unplaced();
    if (LEG_INVARIANTS.includes(id))
        return put(leg, `invariant:${id}`, outcome);
    const fresh = NEW_ROWS.find((n) => n.assertion === id && n.leg === leg);
    if (fresh)
        return put(leg, `new:${id}`, outcome);
    return unplaced();
}
/**
 * Split one case result into per-leg results: a Map from leg id to { [row]: outcome }.
 * A row reported twice keeps its worse outcome. A case result for another case, or one with no assertions array,
 * throws: the runner records the case's legs as FAIL with that reason.
 */
function splitCaseResult(caseId, caseResult) {
    if (!caseResult || caseResult.caseId !== caseId)
        throw new Error(`expected a ${caseId} result, got ${caseResult?.caseId ?? 'nothing'}`);
    if (!Array.isArray(caseResult.assertions))
        throw new Error(`${caseId} result has no assertions`);
    const legs = legsForCase(caseId);
    if (legs.length === 0)
        throw new Error(`${caseId} covers no nightly leg`);
    const out = new Map(legs.map((l) => [l, {}]));
    const rank = { PASS: 0, 'NOT RUN': 1, HOLD: 2, FAIL: 3 };
    const put = (leg, row, outcome) => {
        const r = out.get(leg);
        if (!(row in r) || rank[outcome] > rank[r[row]])
            r[row] = outcome;
    };
    if (isInvocation(caseId)) {
        for (const a of caseResult.assertions)
            placeInvocationRow(caseId, legs, a, put);
    }
    else {
        for (const a of caseResult.assertions)
            placeCaseRow(caseId, legs, a, put);
    }
    // The harness stops a Start press past the case's cap and writes start-press-budget as NOT RUN with
    // executionSignals.startPressCapExceeded. For the nightly that is an overrun of a frozen allocation: FAIL on every leg
    // of the case, which no later NOT RUN can hide.
    if (caseResult.executionSignals?.startPressCapExceeded === true)
        for (const leg of legs)
            put(leg, 'invariant:start-press-budget', 'FAIL');
    return out;
}

module.exports = { legsForCase, outcomeOf, splitCaseResult };
