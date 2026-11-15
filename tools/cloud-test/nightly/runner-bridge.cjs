"use strict";
// Nightly AHT suite: the bridge from this folder's run budget, cleanup evidence and leg verdicts to the existing harness
// runner (`harness/bundle/harness/campaign-core.cjs` `runCampaign`), without editing the pinned harness packet. It wraps
// the adapter (`io`) that runCampaign drives:
//   - admit: the run budget is planned from the run request's named legs (a ceiling that can't cover them, or a run
//     naming a leg with no reviewed cleanup such as J2, is refused here), frozen into the run directory, and the run is
//     admitted and its start recorded (`beginRun`), all before the harness's own admission, so a refused run sends
//     nothing;
//   - runCase: the case gets `opts.nightly`: its allocated legs, `send(leg, kind, fn)` for every ordinary send (coaching,
//     Start press), `cleanup(leg, fn)` for every cleanup request, each reserved before it leaves, and `created(leg,
//     { kind, ref })`, called before any send that creates a resource: that record, not the teardown's own report,
//     decides what the journey's cleanup must cover (an omitted resource can't look clean). It returns its usual
//     result plus `nightlyCleanup` for its journey ({ steps, left, verification }, see cleanup-evidence.cjs). Its rows
//     become leg verdicts with the leg's budget facts;
//   - save (called by runCampaign after every case): attaches an interim nightly summary only;
//   - finish (called ONCE by the nightly runner after runCampaign returns): reconciles the leg verdicts with the
//     harness's own case and terminal results, writes the cleanup evidence once (a journey no case accounted for is
//     written with no verification, so it is incomplete), and saves the final report.
// The harness case process does not route its sends through `nightly` yet: that is the next step of #1865's harness
// handoff (§3). Until then this bridge is proven offline only and must not be given a live run.
const fs = require('node:fs');
const { CLEANUP, RunRefused, openSharedRunBudget, planRunBudget, writeSharedPlan } = require('./run-budget.cjs');
const { CleanupUndefined, cleanupReserve } = require('./cleanup-plan.cjs');
const { beginRun, unprovenCleanup, writeCleanupEvidence } = require('./cleanup-evidence.cjs');
const { legsForCase, splitCaseResult } = require('./case-results.cjs');
const { VerdictLedger, legVerdict, runVerdict } = require('./leg-verdicts.cjs');
const { legById } = require('./journey-plan.cjs');

/** The harness cases that carry the named legs, in plan order: the `selection.ids` for runCampaign. */
function casesForLegs(legs) {
    return [...new Set(legs.map((l) => legById(l).caseId).filter(Boolean))];
}

const VERIFICATION_SHAPE = (v) => v === undefined || (!!v && typeof v === 'object'
    && (v.kind === 'nothing-created' || (v.kind === 'zero-residue' && Array.isArray(v.queries))));
/**
 * Combines the cleanup a journey's cases reported. Each case's proof is first checked against that case's OWN steps,
 * leftovers and created resources (Codex P2 on 2ba59540): a zero-residue query from one case must not stand in for
 * another case's missing or empty check. Every case's reasons are kept (`unproven`), so the journey stays incomplete.
 * Any case with no verification also leaves the combined journey unverified.
 */
function combineCleanup(parts) {
    const steps = parts.flatMap((p) => p.steps ?? []);
    const left = parts.flatMap((p) => p.left ?? []);
    const unproven = parts.flatMap((p, i) => {
        const who = p.caseId ?? `case ${i + 1}`;
        if (!VERIFICATION_SHAPE(p.verification))
            return [`${who}: its residue verification is malformed`];
        return unprovenCleanup({ reserveExhausted: false, steps: p.steps ?? [], left: p.left ?? [], created: p.created ?? [], verification: p.verification })
            .map((r) => `${who}: ${r}`);
    });
    const withUnproven = (o) => (unproven.length > 0 ? { ...o, unproven } : o);
    if (parts.length === 0 || parts.some((p) => p.verification === undefined || !VERIFICATION_SHAPE(p.verification)))
        return withUnproven({ steps, left });
    if (parts.every((p) => p.verification.kind === 'nothing-created'))
        return withUnproven({ steps, left, verification: { kind: 'nothing-created' } });
    const queries = parts.flatMap((p) => (p.verification.kind === 'zero-residue' ? p.verification.queries : []));
    return withUnproven({ steps, left, verification: { kind: 'zero-residue', queries } });
}

/**
 * `opts`: { runDir (empty), evidenceDir, runId, selected (legs), satisfiedGates (iterable of gate kinds),
 * coachingCeiling? }. Returns the wrapped adapter and `outcome()` for the run's nightly result.
 */
function nightlyAdapter(io, opts) {
    const satisfiedGates = new Set(opts.satisfiedGates ?? []);
    const ledger = new VerdictLedger();
    const cleanupParts = new Map();
    const createdByJourney = new Map();
    let budget = null;
    let journeys = null;
    let evidence = null;
    const wrapped = {
        ...io,
        async admit(...args) {
            if (budget)
                throw new Error('nightly: the run was already admitted');
            // The budget only marks a leg with no reviewed cleanup (J2) as gated; a run that NAMES one is refused
            // outright, so nothing about it is planned, recorded or sent (handoff milestone: "refuses any run naming J2").
            for (const leg of opts.selected ?? []) {
                try {
                    cleanupReserve(legById(leg).journey);
                }
                catch (e) {
                    if (e instanceof CleanupUndefined)
                        throw new RunRefused(`${leg} is named, but ${e.message}`);
                    throw e;
                }
            }
            const planned = planRunBudget({ satisfiedGates, selected: opts.selected, coachingCeiling: opts.coachingCeiling });
            if (Object.keys(planned.plan().legs).length === 0)
                throw new RunRefused('no named leg is runnable, so there is nothing to run');
            fs.mkdirSync(opts.runDir, { recursive: true });
            writeSharedPlan(opts.runDir, planned);
            const shared = openSharedRunBudget(opts.runDir);
            const j = Object.keys(shared.plan().cleanup).sort();
            beginRun(opts.evidenceDir, opts.runId, j);
            budget = shared;
            journeys = j;
            return io.admit(...args);
        },
        async runCase(c, plan, admission, caseOpts = {}) {
            if (!budget)
                throw new Error('nightly: a case ran before the run was admitted');
            const legs = legsForCase(c.id).filter((l) => budget.allocationOf(l) !== null);
            if (legs.length === 0)
                return { assertions: [], safetyStop: true, reason: `nightly: ${c.id} carries no allocated leg` };
            const own = (leg) => {
                if (!legs.includes(leg))
                    throw new Error(`nightly: ${c.id} cannot send for ${leg}`);
            };
            const createdHere = [];
            const nightly = Object.freeze({
                legs: [...legs],
                send: async (leg, kind, action) => { own(leg); return budget.send(leg, kind, action); },
                cleanup: async (leg, action) => { own(leg); return budget.send(leg, CLEANUP, action); },
                // Called BEFORE the send that creates (or may create) a resource, so an attempt whose answer is lost is
                // still owed cleanup. The runner's record, not the teardown's report, decides what must be cleaned.
                created: (leg, resource) => {
                    own(leg);
                    const journey = legById(leg).journey;
                    const r = { kind: resource?.kind, ref: resource?.ref };
                    createdHere.push(r);
                    createdByJourney.set(journey, [...(createdByJourney.get(journey) ?? []), r]);
                },
            });
            let ran;
            try {
                ran = await io.runCase(c, plan, admission, { ...caseOpts, nightly });
            }
            catch (e) {
                // A case that throws still records its legs' verdicts before the error goes on (Codex P2 on f01e9768):
                // an overrun the budget already holds is FAIL, and a leg that started but never reported its rows is
                // HOLD, never PASS or NOT RUN, so an execution failure can't hide an established overrun.
                for (const leg of legs) {
                    const b = budget.legBudget(leg);
                    ledger.record(b.overrun.length > 0
                        ? legVerdict(leg, { budget: b, prior: ledger.verdicts(), satisfiedGates })
                        : { leg, proofScope: legById(leg).proofScope, outcome: 'HOLD', reason: `the case threw before reporting its rows: ${e?.message ?? e}`, rows: {} });
                }
                throw e;
            }
            finally {
                // Each journey's cleanup is accounted from what the case reported; a case that threw reported nothing.
                const journey = legById(legs[0]).journey;
                const part = { ...(ran?.nightlyCleanup ?? { steps: [], left: [] }), caseId: c.id, created: [...createdHere] };
                cleanupParts.set(journey, [...(cleanupParts.get(journey) ?? []), part]);
            }
            let split = null;
            let splitError = null;
            try {
                // The whole case result goes to the splitter, so the harness's execution signals (a Start press stopped
                // at the cap: executionSignals.startPressCapExceeded) still make the case's legs FAIL (Codex P2 on 1d2bb043).
                split = splitCaseResult(c.id, { ...ran, caseId: c.id, assertions: ran.assertions ?? [] });
            }
            catch (e) {
                splitError = e.message;
            }
            for (const leg of legs) {
                const facts = { budget: budget.legBudget(leg), prior: ledger.verdicts(), satisfiedGates };
                const v = splitError
                    ? { leg, proofScope: legById(leg).proofScope, outcome: 'FAIL', reason: `case result unusable: ${splitError}`, rows: {} }
                    : legVerdict(leg, { ...facts, results: split.get(leg) });
                ledger.record(v);
            }
            return ran;
        },
        // runCampaign saves after every case (a checkpoint), so save only attaches an interim summary. The cleanup evidence
        // is written once, by `finish`, after the whole campaign (Codex P1 on a09d4da8): a checkpoint must never publish a
        // journey as complete before its later cases ran, nor seal a not-yet-run journey as incomplete.
        async save(report) {
            if (report && typeof report === 'object')
                report.nightly = { ...outcome(), interim: !finished };
            return io.save(report);
        },
    };
    let finished = false;
    /**
     * Reconciles the leg verdicts with what the harness accepted (Codex P2 on a09d4da8): a leg recorded PASS whose case
     * the harness invalidated or did not pass (a failed post-case identity read, a safety stop), or any PASS leg of a
     * run the harness did not complete (result NOT RUN: the final identity unproven), becomes HOLD. A FAIL stays FAIL.
     */
    function reconcile(report) {
        for (const row of Array.isArray(report?.cases) ? report.cases : []) {
            const rejected = row?.executionInvalid === true || (row?.result !== undefined && row.result !== 'PASS');
            if (!rejected)
                continue;
            for (const leg of legsForCase(row.caseId)) {
                if (ledger.get(leg)?.outcome === 'PASS')
                    ledger.record({ ...ledger.get(leg), outcome: 'HOLD', reason: `the harness did not accept ${row.caseId}'s run: ${row.reason ?? row.result}` });
            }
        }
        // A selected run's own result is `selectedResult` (`result` counts all 15 cases, so it is NOT RUN by design). The
        // run is complete only with a verified final identity, no safety stop, and a selected result of PASS or FAIL.
        const terminal = report?.selection ? report.selectedResult : report?.result;
        const completed = report?.finalIdentity === 'MATCH' && report?.safetyStopped !== true && (terminal === 'PASS' || terminal === 'FAIL');
        if (!completed) {
            const why = `final identity ${report?.finalIdentity ?? 'missing'}, result ${terminal ?? 'missing'}${report?.safetyStopped ? ', safety stop' : ''}${report?.reason ? `: ${report.reason}` : ''}`;
            for (const [, v] of ledger.verdicts()) {
                if (v.outcome === 'PASS')
                    ledger.record({ ...v, outcome: 'HOLD', reason: `the harness did not complete the run (${why})` });
            }
        }
    }
    /**
     * Call once, after runCampaign returns, with its report: reconciles the verdicts, writes the run's cleanup evidence
     * (every journey, with the runner's record of what it created; a torn or unreadable journal is a run fault) and saves
     * the final report. A runner that dies before this leaves its start record with no evidence, so admission stays shut.
     */
    async function finish(report) {
        if (finished)
            throw new Error('nightly: the run was already finished');
        finished = true;
        if (budget && journeys) {
            reconcile(report);
            const entries = journeys.map((journey) => ({
                journey, reserveExhausted: false, ...combineCleanup(cleanupParts.get(journey) ?? []),
                created: createdByJourney.get(journey) ?? [],
            }));
            const torn = budget.journalTorn();
            const runFaults = torn === null ? ['the run budget journal could not be read']
                : torn > 0 ? [`${torn} run budget journal write(s) were cut short`] : [];
            evidence = writeCleanupEvidence(opts.evidenceDir, opts.runId, entries, { cleanupExhausted: (j) => budget.cleanupExhausted(j), runFaults });
        }
        if (report && typeof report === 'object')
            report.nightly = { ...outcome(), interim: false };
        return io.save(report);
    }
    function outcome() {
        const verdicts = ledger.verdicts();
        return {
            admitted: budget !== null,
            cleanup: evidence ? { result: evidence.cleanup, incompleteJourneys: evidence.incompleteJourneys, reasons: evidence.incompleteReasons } : null,
            journalTorn: budget ? budget.journalTorn() : null,
            legs: Object.fromEntries([...verdicts].map(([leg, v]) => [leg, { outcome: v.outcome, reason: v.reason }])),
            run: runVerdict(verdicts, budget ? budget.allocatedLegs() : []),
        };
    }
    return { io: wrapped, outcome, finish };
}

module.exports = { casesForLegs, combineCleanup, nightlyAdapter };
