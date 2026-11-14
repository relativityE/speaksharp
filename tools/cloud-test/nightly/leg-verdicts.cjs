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
    // A budget that can't be called clean (unreadable or torn journal) can hide an overrun: HOLD at least, never PASS.
    if (budget.allocated && budget.hold)
        notRunCauses.push(budget.hold);
    const later = notRunCauses.length > 0 ? `; also ${notRunCauses.join('; ')}` : '';
    if (budget.overrun.length > 0) {
        const rows = recorded ? recorded.rows : allRows(legId, 'NOT RUN');
        return { ...base, outcome: 'FAIL', reason: `asked for more than its frozen ${budget.overrun.join(' and ')} allocation${later}`, rows };
    }
    if (recorded && recorded.outcome === 'FAIL')
        return { ...base, outcome: 'FAIL', reason: `${recorded.reason}${later}`, rows: recorded.rows };
    // Everything else that keeps the leg from passing is folded by severity, so HOLD outranks NOT RUN wherever it comes
    // from: a dependent leg with a HOLD gate, or HOLD rows, is HOLD, not NOT RUN (design §1: HOLD over NOT RUN). A
    // dependency that did not pass still keeps the leg from PASS: a PASS recorded without it is not counted.
    if (notRunCauses.length > 0) {
        const outcomes = [
            ...plan.needs.filter((dep) => !input.prior.get(dep) || input.prior.get(dep).outcome !== 'PASS').map(() => 'NOT RUN'),
            ...unmet.map((g) => g.outcome),
            ...(budget.allocated ? [] : ['NOT RUN']),
            ...(budget.allocated && budget.hold ? ['HOLD'] : []),
            ...(recorded && recorded.outcome === 'HOLD' ? ['HOLD'] : []),
        ];
        const outcome = fold(outcomes);
        const reasons = recorded && recorded.outcome === 'HOLD' ? [...notRunCauses, recorded.reason] : notRunCauses;
        // Recorded rows stand as recorded (a PASS row stays PASS, a HOLD row HOLD); rows that never ran take the outcome.
        return { ...base, outcome, reason: reasons.join('; '), rows: recorded ? recorded.rows : allRows(legId, outcome) };
    }
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
/**
 * The full suite's result: PASS only when every planned leg PASSed. Any FAIL is FAIL. Anything else (HOLD, NOT RUN,
 * missing) is INCOMPLETE. J9.b is NOT RUN by design, so the full suite reads INCOMPLETE every night; that is the truth
 * and stays the headline.
 *
 * `scopeLegs` (optional) names the legs the run request selected and the run budget allocated. Their result is
 * labelled apart, as the selected scope, so a night where every one of them passed is visible without calling the
 * whole suite green: `scope.outcome` is PASS only when every scope leg PASSed, FAIL when one failed, and INCOMPLETE
 * otherwise. The scope never changes `outcome`.
 */
function runVerdict(verdicts, scopeLegs = []) {
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
    const outcome = failed ? 'FAIL' : notGreen.length > 0 ? 'INCOMPLETE' : 'PASS';
    const why = (id) => verdicts.get(id)?.reason ?? 'no verdict';
    const short = (t) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);
    const notGreenWhy = ALL_LEGS.filter((l) => verdicts.get(l.id)?.outcome !== 'PASS').map((l) => `${l.id} ${verdicts.get(l.id)?.outcome ?? 'NOT RUN'} (${short(why(l.id))})`);
    const reason = outcome === 'PASS' ? 'every planned leg passed'
        : outcome === 'FAIL' ? `a leg failed: ${notGreen.filter((n) => / FAIL$| unknown leg$/.test(n)).join(', ')}`
            : `not every planned leg passed, so this is not a full PASS: ${notGreenWhy.join('; ')}`;
    return { outcome, reason, notGreen, scope: scopeVerdict(verdicts, scopeLegs, outcome) };
}
/**
 * The runnable legs' summary, kept apart from the full-suite result. "All runnable legs passed" only when every leg
 * the run request named and the budget allocated PASSed; it names how many ran and every planned leg left out, with
 * why, and it never changes the full-suite outcome.
 */
function scopeVerdict(verdicts, scopeLegs, suite) {
    if (!Array.isArray(scopeLegs) || scopeLegs.length === 0)
        return null;
    for (const id of scopeLegs)
        legById(id);
    const legs = [...new Set(scopeLegs)];
    const outcomes = legs.map((id) => verdicts.get(id)?.outcome ?? 'NOT RUN');
    const outcome = outcomes.includes('FAIL') ? 'FAIL' : outcomes.every((o) => o === 'PASS') ? 'PASS' : 'INCOMPLETE';
    const excluded = ALL_LEGS.filter((l) => !legs.includes(l.id)).map((l) => {
        const v = verdicts.get(l.id);
        return Object.freeze({ leg: l.id, outcome: v?.outcome ?? 'NOT RUN', reason: v?.reason ?? 'not selected for this run' });
    });
    // "Run" counts the scope legs that reached a result; a selected leg that never ran is NOT RUN and is not counted.
    const run = outcomes.filter((o) => o !== 'NOT RUN').length;
    const head = outcome === 'PASS' ? 'All runnable legs passed'
        : outcome === 'FAIL' ? 'A runnable leg failed' : 'Not every runnable leg passed';
    const ex = excluded.length > 0 ? `; excluded: ${excluded.map((e) => `${e.leg} ${e.outcome}`).join(', ')}` : '; nothing excluded';
    return {
        outcome, legs, selected: legs.length, run, excluded,
        summary: `${head}: ${run} of ${ALL_LEGS.length} planned legs run${run === legs.length ? '' : ` (${legs.length} selected)`}${ex}. Full suite: ${suite}.`,
    };
}
/** One report line per leg. A sandbox result names its scope, so it can't be read as production billing proof. */
function verdictLine(v) {
    const scope = v.proofScope === 'stripe-test-mode-sandbox' ? ' [Stripe test-mode sandbox: not production billing proof]' : '';
    return `${v.leg} ${v.outcome}${scope}: ${v.reason}`;
}

module.exports = { VerdictLedger, legVerdict, runVerdict, unmetGates, verdictLine };
