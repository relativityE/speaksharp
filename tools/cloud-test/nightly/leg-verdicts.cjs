"use strict";
// Nightly AHT suite: leg and run verdicts.
//
// The rules (design §1, Sam's review, Akin's framework): a leg PASSes only when every row it must report PASSed;
// a dependent leg whose dependency did not PASS is NOT RUN, never FAIL and never PASS; a gate that is unmet is its
// own outcome (HOLD or NOT RUN); a leg that never ran is NOT RUN. A run with any HOLD or NOT RUN leg is not green.
const { ALL_LEGS, legById, rowsForLeg } = require('./journey-plan.cjs');
/** Severity order used to fold rows into a leg: one FAIL fails the leg; otherwise one HOLD holds it; otherwise one NOT RUN. */
const SEVERITY = Object.freeze({ PASS: 0, 'NOT RUN': 1, HOLD: 2, FAIL: 3 });
function fold(outcomes) {
    if (outcomes.length === 0)
        return 'NOT RUN';
    return outcomes.reduce((worst, o) => (SEVERITY[o] > SEVERITY[worst] ? o : worst), 'PASS');
}
const allRows = (legId, o) => Object.fromEntries(rowsForLeg(legId).map((r) => [r, o]));
/** Gates that are unmet, from facts the runner established before the leg (never from the leg's own results). */
function unmetGates(gates, satisfied) {
    return gates.filter((g) => !satisfied.has(g.kind));
}
/**
 * The leg's verdict.
 * - `prior`: verdicts of legs already settled in this run (the dependency source).
 * - `satisfiedGates`: gate kinds the runner established as met.
 * - `results`: row outcomes the leg reported, or undefined when the leg did not run.
 * - `stoppedForBudget`: this leg's journey had a coaching request refused (CoachingBudget.journeyStopped).
 */
function legVerdict(legId, input) {
    const plan = legById(legId);
    for (const dep of plan.needs) {
        const d = input.prior.get(dep);
        if (!d || d.outcome !== 'PASS') {
            return { leg: legId, proofScope: plan.proofScope, outcome: 'NOT RUN', reason: `needs ${dep}, which ${d ? `was ${d.outcome}` : 'has no verdict'}`, rows: allRows(legId, 'NOT RUN') };
        }
    }
    const unmet = unmetGates(plan.gates, input.satisfiedGates);
    if (unmet.length > 0) {
        const outcome = fold(unmet.map((g) => g.outcome));
        return { leg: legId, proofScope: plan.proofScope, outcome, reason: unmet.map((g) => g.reason).join('; '), rows: allRows(legId, outcome) };
    }
    if (input.stoppedForBudget && plan.needsCoaching) {
        return { leg: legId, proofScope: plan.proofScope, outcome: 'NOT RUN', reason: "the journey's coaching was stopped at its cap before this leg", rows: allRows(legId, 'NOT RUN') };
    }
    if (!input.results) {
        return { leg: legId, proofScope: plan.proofScope, outcome: 'NOT RUN', reason: 'the leg did not run', rows: allRows(legId, 'NOT RUN') };
    }
    const required = rowsForLeg(legId);
    const rows = {};
    for (const r of required)
        rows[r] = input.results[r] ?? 'NOT RUN';
    const unexpected = Object.keys(input.results).filter((r) => !required.includes(r));
    if (unexpected.length > 0) {
        // A row the plan doesn't know about can't be counted; reporting it would hide a missing one.
        return { leg: legId, proofScope: plan.proofScope, outcome: 'FAIL', reason: `reported rows outside the plan: ${unexpected.join(', ')}`, rows };
    }
    const outcome = fold(Object.values(rows));
    const reason = outcome === 'PASS' ? 'every row passed'
        : `${Object.entries(rows).filter(([, o]) => o !== 'PASS').map(([r, o]) => `${r} ${o}`).join(', ')}`;
    return { leg: legId, proofScope: plan.proofScope, outcome, reason, rows };
}
/** PASS only when every planned leg PASSed. Any FAIL is FAIL. Anything else (HOLD, NOT RUN, missing) is INCOMPLETE. */
function runVerdict(verdicts) {
    const notGreen = [];
    let failed = false;
    for (const l of ALL_LEGS) {
        const v = verdicts.get(l.id);
        if (!v) {
            notGreen.push(`${l.id} NOT RUN`);
            continue;
        }
        if (v.outcome === 'FAIL')
            failed = true;
        if (v.outcome !== 'PASS')
            notGreen.push(`${l.id} ${v.outcome}`);
    }
    const extra = [...verdicts.keys()].filter((k) => !ALL_LEGS.some((l) => l.id === k));
    if (extra.length > 0) {
        failed = true;
        notGreen.push(...extra.map((k) => `${k} unknown leg`));
    }
    return { outcome: failed ? 'FAIL' : notGreen.length > 0 ? 'INCOMPLETE' : 'PASS', notGreen };
}
/** One report line per leg. A sandbox result names its scope, so it can't be read as production billing proof. */
function verdictLine(v) {
    const scope = v.proofScope === 'stripe-test-mode-sandbox' ? ' [Stripe test-mode sandbox: not production billing proof]' : '';
    return `${v.leg} ${v.outcome}${scope}: ${v.reason}`;
}

module.exports = { legVerdict, runVerdict, unmetGates, verdictLine };
