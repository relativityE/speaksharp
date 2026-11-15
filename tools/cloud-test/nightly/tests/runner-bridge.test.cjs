'use strict';
// Milestone 1 of the nightly runner (#1865 harness handoff §3, Sam's 14 Nov plan): one journey (J6, harness case AHT-11)
// through the REAL harness runner (`campaign-core.runCampaign`, unmodified) offline, with the run budget, cleanup
// evidence and leg verdicts wired through runner-bridge.cjs. No browser, no network, no production: the case is a fake
// that sends only through the `nightly` hooks it is given, onto a recorded wire.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { IDS, runCampaign } = require('../../harness/bundle/harness/campaign-core.cjs');
const { admitRun } = require('../cleanup-evidence.cjs');
const { cleanupReserve } = require('../cleanup-plan.cjs');
const { rowsForLeg } = require('../journey-plan.cjs');
const { legsForCase } = require('../case-results.cjs');
const { casesForLegs, combineCleanup, nightlyAdapter } = require('../runner-bridge.cjs');

const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const NOW = Date.parse('2026-11-14T12:00:00Z');
const J6_ROWS = [...new Set(rowsForLeg('J6').map((r) => r.split(':')[1]))];
const POSITIVE = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false, mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true, cleanupIncomplete: false };

function campaignPlan(legs) {
    return {
        version: 1, campaignId: 'UNIT-NIGHTLY-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
        sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
        stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
        deadlineAt: '2026-11-14T13:00:00Z', cleanupReserveMs: 1000,
        cases: IDS.map((id) => ({ id, driverFile: `${id}.cjs`, driverSha256: hash, configFile: `${id}.json`, configSha256: hash, maxMs: 100 })),
        selection: { ids: casesForLegs(legs), ownerApprovalReference: 'unit-offline-proof-not-a-run', reason: 'nightly runner bridge offline proof' },
    };
}

/**
 * A fake harness adapter whose only case is AHT-11. `scenario`: starts and coaching it asks to send, `residue` (count
 * its residue query returns), `left` (resources it reports left), `tearJournal` (a write cut short mid-case), `skipVerify`.
 */
/** The raw row ids a case reports for the legs it covers (its own and the invariants). */
const rowsFor = (caseId) => [...new Set(legsForCase(caseId).flatMap((l) => rowsForLeg(l))
    .filter((r) => r.startsWith(`${caseId}:`) || r.startsWith('invariant:')).map((r) => r.split(':')[1]))];
function fakeIo(scenario, wire) {
    const calls = [];
    const evidenceAtSave = [];
    return {
        calls,
        evidenceAtSave,
        now: () => NOW,
        save: async () => { evidenceAtSave.push(scenario.evidenceFile ? fs.existsSync(scenario.evidenceFile) : null); },
        preflightCase: async () => {},
        admit: async () => { calls.push('admit'); return { result: 'ADMISSION PASS' }; },
        identity: async (phase) => {
            calls.push(`identity:${phase}`);
            return { result: 'MATCH', servedSha: phase === scenario.identityMismatchAt ? 'c'.repeat(40) : commit };
        },
        caseConfig: async (c) => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: rowsFor(c.id) }),
        runCase: async (c, _plan, _admission, { nightly }) => {
            calls.push(`run:${c.id}`);
            const leg = nightly.legs[0];
            const refused = [];
            const j6 = c.id === 'AHT-11';
            // The runner records what it creates BEFORE the creating send; the teardown's report can't erase it.
            nightly.created(leg, { kind: 'account', ref: `acct-unit-${c.id}` });
            if (scenario.createFence)
                nightly.created(leg, { kind: 'feedback-fence', ref: 'fence-unit-J6' });
            for (let i = 0; i < (j6 ? scenario.starts : 0); i += 1) {
                const r = await nightly.send(leg, 'starts', async () => wire.push('starts'));
                if (!r.sent) refused.push('starts');
            }
            for (let i = 0; i < (j6 ? scenario.coaching : 0); i += 1) {
                const r = await nightly.send(leg, 'coaching', async () => wire.push('coaching'));
                if (!r.sent) refused.push('coaching');
            }
            if (scenario.tearJournal)
                fs.appendFileSync(path.join(scenario.runDir, 'budget-journal.jsonl'), '{"t":"grant","leg":"J6"');
            if (scenario.throwAfterSends)
                throw new Error('injected case failure after its sends');
            const del = await nightly.cleanup(leg, async () => { wire.push('cleanup:delete-account'); return true; });
            const query = scenario.skipVerify ? { sent: false } : await nightly.cleanup(leg, async () => { wire.push('cleanup:residue-query'); return scenario.residue ?? 0; });
            const assertions = rowsFor(c.id).map((id) => ({ id, result: scenario.harnessCapStop && id === 'start-press-budget' ? 'NOT RUN' : 'PASS', detail: 'offline fake', evidenceRefs: ['unit.json'] }));
            return {
                assertions, cleanupEvidence: POSITIVE, refused,
                // The harness's own Start-press cap stop (source-adapters.cjs): start-press-budget NOT RUN plus this signal.
                ...(scenario.harnessCapStop ? { executionSignals: { startPressCapExceeded: true } } : {}),
                nightlyCleanup: {
                    steps: scenario.omitSteps ? [] : [{ kind: 'account', ref: `acct-unit-${c.id}`, action: 'delete', outcome: del.sent ? 'done' : 'not attempted' }],
                    left: scenario.leftFor?.[c.id] ?? (j6 ? scenario.left : undefined) ?? [],
                    ...(scenario.claimNothingCreated ? { verification: { kind: 'nothing-created' } }
                        : query.sent ? { verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: `unit-run:${c.id}`, count: query.value }] } } : {}),
                },
            };
        },
    };
}

const dirs = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-bridge-'));
    const evidenceDir = path.join(root, 'evidence');
    fs.mkdirSync(evidenceDir);
    return { root, evidenceDir, runDir: (runId) => path.join(root, `run-${runId}`) };
};
async function nightlyRun(d, runId, { legs = ['J6'], coachingCeiling, ...scenario } = {}) {
    const wire = [];
    const runDir = d.runDir(runId);
    const evidenceFile = path.join(d.evidenceDir, `${runId}.cleanup.json`);
    const raw = fakeIo({ starts: 4, coaching: 2, runDir, evidenceFile, ...scenario }, wire);
    const { io, outcome, finish } = nightlyAdapter(raw, { runDir, evidenceDir: d.evidenceDir, runId, selected: legs, satisfiedGates: [], coachingCeiling });
    const r = await runCampaign(campaignPlan(legs.filter((l) => l !== 'J2')), io, { executeR0: true });
    // As the nightly runner does: finish once, after the whole campaign.
    await finish(r.report);
    return { r, wire, calls: raw.calls, evidenceAtSave: raw.evidenceAtSave, outcome: outcome(), report: r.report };
}

describe('nightly runner bridge: one journey (J6) through the real harness runner, offline', () => {
    it('counts: every ordinary send and every cleanup request leaves only after its reservation', async () => {
        const d = dirs();
        const { wire, calls, outcome, report } = await nightlyRun(d, 'r1');
        assert.deepEqual(calls.filter((c) => c.startsWith('run:')), ['run:AHT-11']);
        assert.deepEqual(wire, ['starts', 'starts', 'starts', 'starts', 'coaching', 'coaching', 'cleanup:delete-account', 'cleanup:residue-query']);
        const journal = fs.readFileSync(path.join(d.runDir('r1'), 'budget-journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.equal(journal.filter((e) => e.t === 'grant').length, wire.length, 'one granted reservation per send');
        assert.equal(outcome.legs.J6.outcome, 'PASS');
        assert.equal(outcome.cleanup.result, 'complete');
        assert.equal(report.nightly.run.scope.outcome, 'PASS');
        assert.equal(report.cases.find((c) => c.caseId === 'AHT-11').result, 'PASS');
    });
    it('stops: a coaching ceiling below the named legs\' need refuses the run before anything is sent or recorded', async () => {
        const d = dirs();
        const { wire, calls, outcome } = await nightlyRun(d, 'r1', { coachingCeiling: 1 });
        assert.deepEqual(wire, []);
        assert.equal(calls.length, 0, 'not even the harness admission ran');
        assert.equal(outcome.admitted, false);
        assert.equal(fs.existsSync(path.join(d.evidenceDir, 'r1.started.json')), false);
        assert.equal(admitRun(d.evidenceDir).admitted, true, 'a refused run leaves nothing to recover');
    });
    it('stops: a run naming J2 (no reviewed checkout cleanup) is refused, even beside a runnable leg', async () => {
        for (const legs of [['J2'], ['J6', 'J2']]) {
            const d = dirs();
            const { wire, calls, outcome } = await nightlyRun(d, 'r1', { legs });
            assert.deepEqual(wire, [], legs.join('+'));
            assert.equal(calls.length, 0, legs.join('+'));
            assert.equal(outcome.admitted, false, legs.join('+'));
        }
    });
    it('stops: a leg past its allocation is FAIL and sends no more ordinary work, but its cleanup still runs and verifies', async () => {
        const d = dirs();
        const { wire, outcome } = await nightlyRun(d, 'r1', { starts: 6, coaching: 2 });
        assert.equal(wire.filter((w) => w === 'starts').length, 4, 'the 5th and 6th Start presses never left');
        assert.equal(wire.filter((w) => w === 'coaching').length, 0, 'after the overrun no ordinary work of any kind leaves');
        assert.deepEqual(wire.slice(-2), ['cleanup:delete-account', 'cleanup:residue-query']);
        assert.equal(outcome.legs.J6.outcome, 'FAIL');
        assert.match(outcome.legs.J6.reason, /asked for more than its frozen/);
        assert.equal(outcome.cleanup.result, 'complete', 'the overrun never reaches the protected cleanup reserve');
        assert.equal(outcome.run.scope.outcome, 'FAIL');
    });
    it('verifies cleanup: complete evidence admits the next run', async () => {
        const d = dirs();
        await nightlyRun(d, 'r1');
        const next = await nightlyRun(d, 'r2');
        assert.equal(next.outcome.admitted, true);
        assert.equal(next.outcome.legs.J6.outcome, 'PASS');
    });
    it('verifies cleanup: a leftover account, a non-zero residue, or a missing residue check refuses the next run', async () => {
        for (const [label, scenario, reason] of [
            ['a leftover account', { left: [{ kind: 'account', ref: 'acct-unit-J6' }] }, 'left behind'],
            ['a residue query that found one', { residue: 1 }, 'found 1'],
            ['no residue check', { skipVerify: true }, 'no residue verification'],
            // Sam, 14 Nov: tied to what the runner created, so an omitted resource can't look clean.
            ['a teardown report that omits the created account', { omitSteps: true }, 'created account acct-unit-AHT-11 has no completed cleanup step'],
            ['"nothing created" after the runner created an account', { omitSteps: true, claimNothingCreated: true }, 'the runner recorded creating 1 resource'],
            ['a created feedback fence the residue check never queried', { createFence: true }, 'no residue query for feedback-fence'],
        ]) {
            const d = dirs();
            const first = await nightlyRun(d, 'r1', scenario);
            assert.equal(first.outcome.cleanup.result, 'incomplete', label);
            assert.ok(first.outcome.cleanup.reasons.J6.some((r) => r.includes(reason)), `${label}: ${JSON.stringify(first.outcome.cleanup.reasons)}`);
            const next = await nightlyRun(d, 'r2');
            assert.equal(next.outcome.admitted, false, label);
            assert.deepEqual(next.wire, [], `${label}: the refused run sent nothing`);
            assert.equal(next.calls.length, 0, label);
        }
    });
    it('verifies cleanup: a journal write cut short mid-run holds the leg, marks cleanup incomplete and refuses the next run', async () => {
        const d = dirs();
        const first = await nightlyRun(d, 'r1', { tearJournal: true });
        assert.equal(first.outcome.journalTorn, 1);
        assert.equal(first.outcome.legs.J6.outcome, 'HOLD', 'a torn journal can hide an overrun: never PASS');
        assert.equal(first.outcome.cleanup.result, 'incomplete');
        assert.ok(first.outcome.cleanup.reasons.J6.some((r) => r.includes('cut short')), JSON.stringify(first.outcome.cleanup.reasons));
        assert.equal((await nightlyRun(d, 'r2')).outcome.admitted, false);
    });
    it('a run killed before its evidence is written refuses the next run', async () => {
        const d = dirs();
        const runDir = d.runDir('r1');
        const raw = fakeIo({ starts: 4, coaching: 2, runDir }, []);
        const { io } = nightlyAdapter(raw, { runDir, evidenceDir: d.evidenceDir, runId: 'r1', selected: ['J6'], satisfiedGates: [] });
        await io.admit(campaignPlan(['J6']));
        // killed here: save never runs
        assert.equal(admitRun(d.evidenceDir).admitted, false);
        assert.equal((await nightlyRun(d, 'r2')).outcome.admitted, false);
    });
    // Codex P1 on a09d4da8: runCampaign saves after every case; cleanup evidence must be published once, after them all.
    it('a two-case journey (J4) writes no evidence at any checkpoint save, and a later case\'s leftover still counts', async () => {
        const ok = await nightlyRun(dirs(), 'r1', { legs: ['J4.a', 'J4.b'] });
        assert.deepEqual(ok.calls.filter((c) => c.startsWith('run:')), ['run:AHT-05', 'run:AHT-06']);
        assert.ok(ok.evidenceAtSave.length >= 3, `saves: ${ok.evidenceAtSave}`);
        assert.ok(ok.evidenceAtSave.slice(0, -1).every((x) => x === false), `no checkpoint save saw evidence: ${ok.evidenceAtSave}`);
        assert.equal(ok.evidenceAtSave.at(-1), true, 'the final save (finish) comes after the evidence');
        assert.equal(ok.outcome.cleanup.result, 'complete');
        const d = dirs();
        const later = await nightlyRun(d, 'r1', { legs: ['J4.a', 'J4.b'], leftFor: { 'AHT-06': [{ kind: 'account', ref: 'acct-unit-AHT-06' }] } });
        assert.equal(later.outcome.cleanup.result, 'incomplete', 'the second case\'s leftover is in the journey\'s evidence');
        assert.deepEqual(later.outcome.cleanup.incompleteJourneys, ['J4']);
        assert.equal((await nightlyRun(d, 'r2', { legs: ['J4.a', 'J4.b'] })).outcome.admitted, false);
    });
    // Codex P2 on a09d4da8: a PASS the harness rejected afterwards must not stand in the nightly summary.
    it('a post-case identity mismatch, or an unverified campaign end, turns the leg\'s PASS into HOLD', async () => {
        for (const phase of ['after-AHT-11', 'campaign-end']) {
            const { outcome, report } = await nightlyRun(dirs(), 'r1', { identityMismatchAt: phase });
            assert.notEqual(report.result, 'PASS', phase);
            assert.equal(outcome.legs.J6.outcome, 'HOLD', `${phase}: ${outcome.legs.J6.reason}`);
            assert.match(outcome.legs.J6.reason, /the harness did not/, phase);
            assert.notEqual(outcome.run.scope.outcome, 'PASS', phase);
            assert.equal(report.nightly.legs.J6.outcome, 'HOLD', phase);
            assert.equal(report.nightly.interim, false, phase);
        }
    });
    // Codex P2 on 1d2bb043: the harness's own cap stop arrives as an execution signal, and the bridge must forward it.
    it('the harness\'s Start-press cap stop (start-press-budget NOT RUN + startPressCapExceeded) is FAIL through the bridge', async () => {
        const { outcome } = await nightlyRun(dirs(), 'r1', { harnessCapStop: true });
        assert.equal(outcome.legs.J6.outcome, 'FAIL');
        assert.equal(outcome.run.scope.outcome, 'FAIL');
    });
    // Codex P2 on f01e9768: a case that throws after overrunning must not hide the overrun.
    it('a case that throws still records its legs: an established overrun is FAIL, otherwise HOLD, never PASS', async () => {
        const overran = await nightlyRun(dirs(), 'r1', { starts: 5, throwAfterSends: true });
        assert.equal(overran.outcome.legs.J6.outcome, 'FAIL');
        assert.match(overran.outcome.legs.J6.reason, /asked for more than its frozen starts/);
        assert.equal(overran.outcome.run.scope.outcome, 'FAIL');
        const threw = await nightlyRun(dirs(), 'r1', { throwAfterSends: true });
        assert.equal(threw.outcome.legs.J6.outcome, 'HOLD');
        assert.match(threw.outcome.legs.J6.reason, /the case threw before reporting its rows/);
        assert.notEqual(threw.outcome.run.scope.outcome, 'PASS');
        assert.equal(threw.outcome.cleanup.result, 'incomplete', 'a case that threw reported no cleanup, so nothing is proven');
    });
    it('the cleanup reserve is the journey\'s own and is fixed before the run', async () => {
        const d = dirs();
        await nightlyRun(d, 'r1');
        const plan = JSON.parse(fs.readFileSync(path.join(d.runDir('r1'), fs.readdirSync(d.runDir('r1')).find((n) => n.includes('plan'))), 'utf8'));
        assert.deepEqual(plan.cleanup?.J6 ?? plan.plan?.cleanup?.J6, { requests: cleanupReserve('J6').requests, seconds: cleanupReserve('J6').seconds });
    });
    it('combines a journey\'s cleanup across cases: any case with no verification leaves the journey unverified', () => {
        const z = (n) => ({ steps: [{ kind: 'account', ref: `a${n}`, action: 'delete', outcome: 'done' }], left: [], verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: `s${n}`, count: 0 }] } });
        assert.equal(combineCleanup([z(1), z(2)]).verification.queries.length, 2);
        assert.equal(combineCleanup([z(1), { steps: [], left: [] }]).verification, undefined);
        assert.equal(combineCleanup([]).verification, undefined);
        assert.deepEqual(combineCleanup([{ steps: [], left: [], verification: { kind: 'nothing-created' } }]).verification, { kind: 'nothing-created' });
    });
});
