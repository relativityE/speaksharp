"use strict";
// Nightly AHT suite: leg and run verdicts.
//
// The rules (design §1, Sam's review, Akin's framework): a leg PASSes only when every row it must report PASSed;
// a dependent leg whose dependency did not PASS is NOT RUN, never FAIL and never PASS; a gate that is unmet is its
// own outcome (HOLD or NOT RUN); a leg that never ran is NOT RUN. A run with any HOLD or NOT RUN leg is not green.
// A FAIL is never hidden: a leg that recorded a FAIL or overran its frozen allocation is FAIL, whatever NOT RUN or HOLD
// comes after, and the run's ledger keeps the worse of two verdicts for the same leg.
const { ALL_LEGS, legById, rowsForLeg } = require('./journey-plan.cjs');
const { outcomeOf } = require('./case-results.cjs');
const { NEVER_SATISFIED } = require('./limits.cjs');
/** Severity order used to fold rows into a leg: one FAIL fails the leg; otherwise one HOLD holds it; otherwise one NOT RUN. */
const SEVERITY = Object.freeze({ PASS: 0, 'NOT RUN': 1, HOLD: 2, FAIL: 3 });
function fold(outcomes) {
    if (outcomes.length === 0)
        return 'NOT RUN';
    return outcomes.reduce((worst, o) => (SEVERITY[o] > SEVERITY[worst] ? o : worst), 'PASS');
}
const allRows = (legId, o) => Object.fromEntries(rowsForLeg(legId).map((r) => [r, o]));
/**
 * Gates that are unmet, from facts the runner established before the leg (never from the leg's own results). A gate no
 * runner can satisfy (J9.b's production proof) stays unmet whatever the runner claims.
 */
function unmetGates(gates, satisfied) {
    return gates.filter((g) => NEVER_SATISFIED.includes(g.kind) || !satisfied.has(g.kind));
}
/** The rows a leg reported, checked against the plan: missing rows are NOT RUN, unknown rows FAIL the leg. */
function recordedRows(legId, results) {
    const required = rowsForLeg(legId);
    const rows = {};
    // Outcomes are normalised as case-results does: the harness's NOT_RUN is NOT RUN, and anything unknown is FAIL.
    for (const r of required)
        rows[r] = r in results ? outcomeOf(results[r]) : 'NOT RUN';
    const unexpected = Object.keys(results).filter((r) => !required.includes(r));
    if (unexpected.length > 0) {
        // A row the plan doesn't know about can't be counted; reporting it would hide a missing one.
        return { rows, outcome: 'FAIL', reason: `reported rows outside the plan: ${unexpected.join(', ')}` };
    }
    const outcome = fold(Object.values(rows));
    const reason = outcome === 'PASS' ? 'every row passed'
        : `${Object.entries(rows).filter(([, o]) => o !== 'PASS').map(([r, o]) => `${r} ${o}`).join(', ')}`;
    return { rows, outcome, reason };
}
/**
 * The leg's verdict.
 * - `prior`: verdicts of legs already settled in this run (the dependency source).
 * - `satisfiedGates`: gate kinds the runner established as met.
 * - `results`: row outcomes the leg reported, or undefined when the leg did not run.
 * - `budget`: the leg's run-budget facts (RunBudget.legBudget): whether it had an allocation, and which kinds it overran.
 *   Without them the leg is NOT RUN: a leg the run budget never saw has no allocation.
 *
 * A FAIL the leg recorded, or an overrun of its frozen allocation, is FAIL whatever else is true: a NOT RUN or HOLD
 * reached later (a dependency, a gate, no allocation) never hides it (Sam's #1864 review).
 */
function legVerdict(legId, input) {
    const plan = legById(legId);
    const base = { leg: legId, proofScope: plan.proofScope };
    const recorded = input.results ? recordedRows(legId, input.results) : null;
    const budget = input.budget ?? { allocated: false, reason: 'the run budget gave no facts for this leg', overrun: [] };
    const notRunCauses = [];
    for (const dep of plan.needs) {
        const d = input.prior.get(dep);
        if (!d || d.outcome !== 'PASS')
            notRunCauses.push(`needs ${dep}, which ${d ? `was ${d.outcome}` : 'has no verdict'}`);
    }
    const unmet = unmetGates(plan.gates, input.satisfiedGates);
    if (unmet.length > 0)
        notRunCauses.push(...unmet.map((g) => g.reason));
    if (!budget.allocated)
        notRunCauses.push(`no budget allocation: ${budget.reason}`);
    const later = notRunCauses.length > 0 ? `; also ${notRunCauses.join('; ')}` : '';
    if (budget.overrun.length > 0) {
        const rows = recorded ? recorded.rows : allRows(legId, 'NOT RUN');
        return { ...base, outcome: 'FAIL', reason: `asked for more than its frozen ${budget.overrun.join(' and ')} allocation${later}`, rows };
    }
    if (recorded && recorded.outcome === 'FAIL')
        return { ...base, outcome: 'FAIL', reason: `${recorded.reason}${later}`, rows: recorded.rows };
    const failedDep = plan.needs.find((dep) => !input.prior.get(dep) || input.prior.get(dep).outcome !== 'PASS');
    if (failedDep !== undefined) {
        const d = input.prior.get(failedDep);
        return { ...base, outcome: 'NOT RUN', reason: `needs ${failedDep}, which ${d ? `was ${d.outcome}` : 'has no verdict'}`, rows: allRows(legId, 'NOT RUN') };
    }
    if (unmet.length > 0) {
        const outcome = fold(unmet.map((g) => g.outcome));
        return { ...base, outcome, reason: unmet.map((g) => g.reason).join('; '), rows: allRows(legId, outcome) };
    }
    if (!budget.allocated)
        return { ...base, outcome: 'NOT RUN', reason: `no budget allocation: ${budget.reason}`, rows: allRows(legId, 'NOT RUN') };
    if (!recorded)
        return { ...base, outcome: 'NOT RUN', reason: 'the leg did not run', rows: allRows(legId, 'NOT RUN') };
    return { ...base, outcome: recorded.outcome, reason: recorded.reason, rows: recorded.rows };
}
/**
 * The run's record of leg verdicts. A leg recorded twice keeps the worse verdict (FAIL over HOLD over NOT RUN over
 * PASS), so a FAIL recorded early survives a NOT RUN recorded later, and nothing ever turns back into PASS.
 */
class VerdictLedger {
    #verdicts = new Map();
    record(v) {
        if (!v || typeof v.leg !== 'string' || !(v.outcome in SEVERITY))
            throw new Error('a verdict needs a leg and a known outcome');
        const had = this.#verdicts.get(v.leg);
        if (!had || SEVERITY[v.outcome] > SEVERITY[had.outcome])
            this.#verdicts.set(v.leg, Object.freeze({ ...v }));
        return this.#verdicts.get(v.leg);
    }
    get(legId) { return this.#verdicts.get(legId); }
    /** A copy, for runVerdict and as the `prior` of later legs. */
    verdicts() { return new Map(this.#verdicts); }
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

module.exports = { VerdictLedger, legVerdict, runVerdict, unmetGates, verdictLine };
