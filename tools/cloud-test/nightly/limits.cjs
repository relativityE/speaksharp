"use strict";
// Nightly AHT suite: the lowest limits that still give a truthful result (#1864 at 2c72705, "Nightly limits" and
// "Margins"; Akin, 14 Nov 17:31Z: "Don't add an automatic 20%. Calculate the lowest limits that produce a truthful
// signal; propose a margin only where the evidence justifies it. Anything skipped must be NOT RUN.").
//
// Counted limits (fresh sign-ups, takes, Start presses, coaching requests, identity reads, provider calls, paid
// actions) follow exactly from the legs that can run. They carry no margin: a retry that needs more fails its row and
// the guard refuses the extra action, so the leg reports NOT RUN instead of spending more.
//
// Measured limits (requests, run minutes) are set per production journey from a baseline run in which every runnable
// leg executed, plus the margin the evidence supports: requests 11%, time 14% (the largest differences between the two
// measured runs on cases whose work matched). With two or more complete baselines the margin is re-checked against
// their spread and comes down if the spread is smaller; it goes up only on the product owner's word. A journey with no
// complete baseline leaves the whole limit unset rather than guessed. J9 runs on the billing sandbox, so it counts
// against none of the production limits. Nothing here applies a limit: the product owner accepts them.
const { ALL_LEGS, JOURNEYS } = require('./journey-plan.cjs');
const RUNS_PER_PERIOD = Object.freeze({ runs: 30, days: 30 });
/** Each coaching request can make up to 3 provider calls (MAX_PROVIDER_ATTEMPTS). */
const PROVIDER_CALLS_PER_COACHING_REQUEST = 3;
/** Evidence-based margin proposals, in percent (#1864 2c72705, "Margins"). Nothing else carries a margin. */
const PROPOSED_MARGIN_PCT = Object.freeze({
    requests: Object.freeze({ pct: 11, evidence: 'largest difference across the five cases whose work matched in R4C and R5: AHT-01, 157 and 174 requests (10.8%)' }),
    minutes: Object.freeze({ pct: 14, evidence: 'largest difference across the same five cases: AHT-02, 128 and 145 seconds (13.3%)' }),
});
/** Gates no runner can satisfy: J9.b stays NOT RUN by design, so it never counts toward a limit, even in the all-legs column. */
const NEVER_SATISFIED = Object.freeze(['no-safe-production-proof']);
/** A leg counts toward a limit only when every gate on it is satisfied. */
function runnable(leg, satisfiedGates) {
    return leg.gates.every((g) => !NEVER_SATISFIED.includes(g.kind) && satisfiedGates.has(g.kind));
}
const isProduction = (l) => l.proofScope === 'deployed-production';
/** The production journeys with at least one runnable leg. */
function runnableJourneys(satisfiedGates) {
    return JOURNEYS.filter((j) => j.legs.some((l) => isProduction(l) && runnable(l, satisfiedGates)));
}
/**
 * The counted limits for the legs that can run, given the gate kinds the runner has established as met.
 * With every gate satisfied: 8 sign-ups, 31 takes, 43 starts, 32 coaching, 18 identity reads, 96 provider calls, $0
 * (#1864's all-legs column, plus J1.e's probe reserved at its worst case, Sam's review). With none it is today's column
 * (7, 30, 40, 30, 16, 90 calls, $0): J1.e is gated today, so its probe reserves nothing.
 */
function countedLimits(satisfiedGates = new Set()) {
    const legs = ALL_LEGS.filter((l) => isProduction(l) && runnable(l, satisfiedGates));
    const journeys = runnableJourneys(satisfiedGates);
    const sum = (f) => legs.reduce((n, l) => n + f(l), 0);
    // Coaching counts every leg's reserve: its saved takes plus the worst case of a probe the server should refuse.
    const coachingRequests = sum((l) => l.coachingReserve);
    return Object.freeze({
        legs: legs.map((l) => l.id),
        notRun: ALL_LEGS.filter((l) => !legs.includes(l)).map((l) => l.id),
        journeys: journeys.map((j) => j.id),
        freshSignUps: journeys.filter((j) => j.account === 'fresh-run-owned').length,
        takes: sum((l) => l.coachingRequests),
        startPresses: sum((l) => l.startPresses),
        coachingRequests,
        // The harness's 2 per case plus 2 (admission and final), read per journey: one read at each journey's start
        // and end, J7.a's separate launch inside J7's pair.
        identityReads: 2 * journeys.length + 2,
        providerCalls: coachingRequests * PROVIDER_CALLS_PER_COACHING_REQUEST,
        paidActionsUsd: 0,
        runsPerPeriod: RUNS_PER_PERIOD,
    });
}
/** Every gate kind in the plan that a runner can satisfy, for the all-legs column. */
function allGateKinds() {
    return new Set(ALL_LEGS.flatMap((l) => l.gates.map((g) => g.kind)).filter((k) => !NEVER_SATISFIED.includes(k)));
}
const completeValues = (runs) => (runs ?? []).filter((r) => r && r.complete === true && Number.isFinite(r.value) && r.value >= 0).map((r) => r.value);
/**
 * One journey's allowance for a measured limit ('requests' counts requests; 'minutes' takes seconds and returns whole
 * minutes). `runs` is [{ complete, value }]; only runs in which every runnable leg executed count.
 */
function journeyAllowance(kind, runs) {
    const proposal = PROPOSED_MARGIN_PCT[kind];
    if (!proposal)
        throw new Error(`${kind} is not a measured limit`);
    const values = completeValues(runs);
    if (values.length === 0)
        return { allowance: null, marginPct: null, basis: 'not set: needs a baseline run in which every runnable leg executed' };
    const base = Math.max(...values);
    let marginPct = proposal.pct;
    let basis = `highest complete baseline ${base}, plus the proposed ${proposal.pct}% (${proposal.evidence})`;
    if (values.length >= 2) {
        const low = Math.min(...values);
        const spreadPct = low > 0 ? ((base - low) / low) * 100 : 0;
        if (spreadPct < proposal.pct) {
            marginPct = spreadPct;
            basis = `highest complete baseline ${base}, plus the ${spreadPct.toFixed(1)}% spread of ${values.length} complete baselines (below the proposed ${proposal.pct}%)`;
        }
    }
    // Rounded to 6 places before the ceiling, so 100 plus 11% is 111, not 112 from floating-point error.
    const raw = Number(((base * (100 + marginPct)) / 100).toFixed(6));
    const allowance = kind === 'minutes' ? Math.ceil(raw / 60) : Math.ceil(raw);
    return { allowance, marginPct, basis };
}
/**
 * A measured run limit: the sum of the runnable production journeys' allowances, or null while any of them has no
 * complete baseline. `baseline` maps a journey id to its runs. The period cap is the run cap times the runs per period.
 */
function measuredLimit(kind, satisfiedGates, baseline = {}) {
    const perJourney = runnableJourneys(satisfiedGates).map((j) => ({ journey: j.id, ...journeyAllowance(kind, baseline[j.id]) }));
    const missing = perJourney.filter((p) => p.allowance === null).map((p) => p.journey);
    const perRun = missing.length > 0 ? null : perJourney.reduce((n, p) => n + p.allowance, 0);
    return {
        limit: kind, perJourney, perRun, perPeriod: perRun === null ? null : perRun * RUNS_PER_PERIOD.runs,
        basis: missing.length > 0 ? `not set: no complete baseline for ${missing.join(', ')}` : 'sum of the runnable journeys\' allowances; a journey that needs more stops there and its remaining legs report NOT RUN',
    };
}
/** A dollar cap: a count times a unit price the product owner supplies. No margin of its own; unset without a price. */
function dollarCap(count, pricePerUnitUsd) {
    if (count === null || !Number.isFinite(pricePerUnitUsd) || pricePerUnitUsd < 0)
        return null;
    return Math.round(count * pricePerUnitUsd * 100) / 100;
}
/** The full table for one night. */
function limitsTable(satisfiedToday = new Set(), baseline = {}, prices = {}) {
    const today = countedLimits(satisfiedToday);
    const minutes = measuredLimit('minutes', satisfiedToday, baseline.minutes);
    return {
        allLegs: countedLimits(allGateKinds()),
        today,
        requests: measuredLimit('requests', satisfiedToday, baseline.requests),
        windowMinutes: minutes,
        githubRunnerMinutes: minutes.perRun,
        providerUsd: dollarCap(today.providerCalls, prices.providerPerCallUsd),
        githubUsd: dollarCap(minutes.perRun, prices.githubPerMinuteUsd),
        rule: 'counted limits are exact; measured limits come from complete baselines plus evidence-based margins; anything left out is NOT RUN, never PASS',
    };
}

module.exports = {
    NEVER_SATISFIED, PROPOSED_MARGIN_PCT, PROVIDER_CALLS_PER_COACHING_REQUEST, RUNS_PER_PERIOD, allGateKinds, countedLimits, dollarCap,
    journeyAllowance, limitsTable, measuredLimit, runnable, runnableJourneys,
};
