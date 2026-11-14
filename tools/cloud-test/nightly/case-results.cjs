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
// fails as a row outside the plan, so a renamed or missing row can never pass silently.
const { ALL_LEGS, CATALOG_ROW_HOMES, LEG_INVARIANTS, NEW_ROWS } = require('./journey-plan.cjs');
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
    for (const a of caseResult.assertions) {
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
    return out;
}

module.exports = { legsForCase, outcomeOf, splitCaseResult };
