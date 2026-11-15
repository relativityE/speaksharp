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

function campaignPlan(legs, deadlineAt = '2026-11-14T13:00:00Z') {
    return {
        version: 1, campaignId: 'UNIT-NIGHTLY-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
        sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
        stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
        deadlineAt, cleanupReserveMs: 1000,
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
            if (phase === scenario.tearJournalAt)
                fs.appendFileSync(path.join(scenario.runDir, 'budget-journal.jsonl'), '{"t":"grant","leg":"J6"');
            return { result: 'MATCH', servedSha: phase === scenario.identityMismatchAt ? 'c'.repeat(40) : commit };
        },
        caseConfig: async (c) => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: rowsFor(c.id) }),
        runCase: async (c, _plan, _admission, { nightly }) => {
            calls.push(`run:${c.id}`);
            const leg = nightly.legs[0];
            const refused = [];
            const j6 = c.id === 'AHT-11';
            // The runner records what it creates BEFORE the creating send; the teardown's report can't erase it.
            if (scenario.create) {
                // Sam, 15 Nov (#1867): the account-create request goes through the ONE guarded route, onto a fake transport.
                const g = scenario.create;
                const attemptsBefore = () => fs.readdirSync(scenario.evidenceDir).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')).length;
                const transport = async ({ token, signal }) => {
                    g.transportCalls.push({ token, signalIsAbortSignal: signal instanceof AbortSignal, attemptRecordedBeforeSend: attemptsBefore() > 0 });
                    wire.push('create:account');
                    if (g.transport === 'lost') throw new Error('response lost (restart after send, before response)');
                    if (g.transport === 'late') {
                        // A callback that resolves only after the client's abort: the request may still complete server-side.
                        // AbortSignal.timeout's timer is unref'd; a ref'd fallback keeps the loop alive until the abort fires.
                        await new Promise((resolve) => {
                            const keepAlive = setTimeout(resolve, 5_000);
                            signal.addEventListener('abort', () => { clearTimeout(keepAlive); resolve(); }, { once: true });
                        });
                        return { outcome: 'created', accountRef: 'acct-server-unit' };
                    }
                    if (g.transport === 'ambiguous') return { ok: true };
                    if (g.transport === 'refused') return { outcome: 'refused', status: 422 };
                    return { outcome: 'created', accountRef: 'acct-server-unit' };
                };
                if (g.unwritableEvidence) fs.chmodSync(scenario.evidenceDir, 0o500);
                try {
                    for (let i = 0; i < (g.times ?? 1); i += 1)
                        g.results.push(await nightly.createAccount(leg, `acct-unit-${c.id}`, transport));
                }
                finally {
                    if (g.unwritableEvidence) fs.chmodSync(scenario.evidenceDir, 0o700);
                }
            }
            else
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
                        : scenario.emptyQueriesFor === c.id ? { verification: { kind: 'zero-residue', queries: [] } }
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
async function nightlyRun(d, runId, { legs = ['J6'], coachingCeiling, createDeadlineMs, ...scenario } = {}) {
    const wire = [];
    const runDir = d.runDir(runId);
    const evidenceFile = path.join(d.evidenceDir, `${runId}.cleanup.json`);
    const raw = fakeIo({ starts: 4, coaching: 2, runDir, evidenceFile, evidenceDir: d.evidenceDir, ...scenario }, wire);
    const { io, outcome, finish } = nightlyAdapter(raw, { runDir, evidenceDir: d.evidenceDir, runId, selected: legs, satisfiedGates: [], coachingCeiling, createDeadlineMs });
    const r = await runCampaign(campaignPlan(legs.filter((l) => l !== 'J2'), scenario.deadlineAt), io, { executeR0: true });
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
    // Sam, 14 Nov: the time boundary. Work that fits on its own is refused when work plus the cleanup reserve does not.
    it('stops: work that fits the deadline alone is refused when work plus the cleanup reserve does not', async () => {
        const { caseWorstCaseMs } = require('../../harness/bundle/harness/campaign-core.cjs');
        const work = caseWorstCaseMs(campaignPlan(['J6']), campaignPlan(['J6']).cases.find((c) => c.id === 'AHT-11'));
        const reserve = cleanupReserve('J6').seconds * 1000;
        const tight = new Date(NOW + work + reserve - 1000).toISOString();
        assert.ok(work < reserve, 'the case\'s own worst case fits; only the reserve does not');
        const d = dirs();
        const { wire, calls, outcome } = await nightlyRun(d, 'r1', { deadlineAt: tight });
        assert.deepEqual(wire, []);
        assert.equal(calls.length, 0, 'not even the harness admission ran');
        assert.equal(outcome.admitted, false);
        assert.equal(fs.existsSync(path.join(d.evidenceDir, 'r1.started.json')), false);
        const enough = await nightlyRun(dirs(), 'r1', { deadlineAt: new Date(NOW + work + reserve + 1000).toISOString() });
        assert.equal(enough.outcome.admitted, true);
        assert.equal(enough.outcome.legs.J6.outcome, 'PASS');
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
    // Codex P2 on 01607310: a journal torn after a leg recorded PASS must reach that leg's final verdict.
    it('a journal torn after the leg recorded PASS (at the campaign-end identity read) turns the final PASS into HOLD', async () => {
        const { outcome, report } = await nightlyRun(dirs(), 'r1', { tearJournalAt: 'campaign-end' });
        assert.equal(outcome.journalTorn, 1);
        assert.equal(outcome.legs.J6.outcome, 'HOLD', outcome.legs.J6.reason);
        assert.match(outcome.legs.J6.reason, /cut short \(found at the end of the run\)/);
        assert.notEqual(outcome.run.scope.outcome, 'PASS');
        assert.equal(report.nightly.legs.J6.outcome, 'HOLD');
        assert.equal(outcome.cleanup.result, 'incomplete');
    });
    // Codex P2 on 2ba59540: one case's residue query must not stand in for another case's missing proof.
    it('validates each case\'s cleanup proof on its own: J4 with an empty check in its second case stays incomplete', async () => {
        const d = dirs();
        const run = await nightlyRun(d, 'r1', { legs: ['J4.a', 'J4.b'], emptyQueriesFor: 'AHT-06' });
        assert.equal(run.outcome.cleanup.result, 'incomplete');
        assert.ok(run.outcome.cleanup.reasons.J4.some((r) => r.startsWith('AHT-06:') && r.includes('ran no query')), JSON.stringify(run.outcome.cleanup.reasons));
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

// Sam, 15 Nov (#1867): an account-create request is reserved and recorded durably before it can leave, and an unanswered one
// blocks admission until THAT account is proven gone after the request could no longer complete. Real bridge route
// (`nightly.createAccount`), real budget journal and evidence directory, fake transport.
describe('nightly runner bridge: the guarded account-create route', () => {
    const { recordAttemptRecovery, recordRecovery } = require('../cleanup-evidence.cjs');
    const guarded = (over = {}) => ({ transport: 'ok', transportCalls: [], results: [], ...over });
    const attemptStem = (d, runId) => fs.readdirSync(d.evidenceDir).find((n) => n.startsWith(`${runId}.attempt.`) && n.endsWith('.sent.json'));
    const sentOf = (d, runId) => JSON.parse(fs.readFileSync(path.join(d.evidenceDir, attemptStem(d, runId)), 'utf8'));
    const answeredPath = (d, runId) => path.join(d.evidenceDir, attemptStem(d, runId).replace('.sent.json', '.answered.json'));
    it('reserved, then recorded durably, then sent; a validated created result with complete cleanup readmits', async () => {
        const d = dirs();
        const create = guarded();
        const { wire, outcome } = await nightlyRun(d, 'g1', { create });
        assert.equal(create.transportCalls.length, 1);
        assert.equal(create.transportCalls[0].attemptRecordedBeforeSend, true, 'the attempt was on disk before the transport was called');
        assert.equal(create.transportCalls[0].signalIsAbortSignal, true, 'the transport is held to a deadline');
        assert.equal(create.transportCalls[0].token.kind, 'signups', 'the send carries its granted signups reservation');
        assert.equal(create.results[0].answered, true);
        assert.equal(wire[0], 'create:account');
        assert.equal(sentOf(d, 'g1').lookupRef, 'acct-unit-AHT-11');
        const answered = JSON.parse(fs.readFileSync(answeredPath(d, 'g1'), 'utf8'));
        assert.equal(answered.result.outcome, 'created');
        assert.equal(answered.result.beforeAbort, true);
        const journal = fs.readFileSync(path.join(d.runDir('g1'), 'budget-journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.equal(journal.filter((e) => e.t === 'grant' && e.kind === 'signups').length, 1);
        assert.equal(outcome.cleanup.result, 'complete');
        assert.equal(admitRun(d.evidenceDir).admitted, true);
    });
    it('a second create on the same leg is past its frozen allocation: refused, and the transport is never called', async () => {
        const d = dirs();
        const create = guarded({ times: 2 });
        await nightlyRun(d, 'g2', { create });
        assert.equal(create.transportCalls.length, 1);
        assert.equal(create.results[1].sent, false);
        assert.match(create.results[1].reason, /signups allocation of 1/);
    });
    it('a sibling leg that reuses its journey\'s account has no sign-up to reserve', () => {
        const { planRunBudget } = require('../run-budget.cjs');
        const b = planRunBudget({ satisfiedGates: new Set(), selected: ['J1.a', 'J1.b'] });
        assert.equal(b.allocationOf('J1.a').signups, 1);
        assert.equal(b.allocationOf('J1.b').signups, 0);
        assert.equal(b.reserve('J1.b', 'signups').granted, false);
    });
    it('failed persistence: the attempt cannot be recorded, so nothing is sent (zero transport calls)', async () => {
        const d = dirs();
        const create = guarded({ unwritableEvidence: true });
        await nightlyRun(d, 'g3', { create });
        assert.equal(create.transportCalls.length, 0);
        assert.equal(create.results[0].sent, false);
        assert.match(create.results[0].reason, /could not be recorded, so nothing was sent/);
    });
    it('restart after send, before the response: the next run is refused, and a bare run recovery marker does not reopen it', async () => {
        const d = dirs();
        const create = guarded({ transport: 'lost' });
        await nightlyRun(d, 'g4', { create }).catch(() => undefined);
        assert.equal(create.transportCalls.length, 1);
        assert.equal(fs.existsSync(answeredPath(d, 'g4')), false, 'no terminal result');
        const first = admitRun(d.evidenceDir);
        assert.equal(first.admitted, false);
        assert.ok(first.blocking.some((b) => /has no terminal result; recover that exact account first/.test(b)));
        recordRecovery(d.evidenceDir, 'g4', 'unit-bare-run-recovery');
        assert.equal(admitRun(d.evidenceDir).admitted, false, 'a run-level marker never clears an unresolved create');
    });
    it('LATE callback after the abort: the result is not an answer; the attempt stays unresolved and admission blocked', async () => {
        const d = dirs();
        const create = guarded({ transport: 'late' });
        await nightlyRun(d, 'g6', { create, createDeadlineMs: 20 });
        assert.equal(create.results[0].sent, true);
        assert.equal(create.results[0].answered, false);
        assert.match(create.results[0].reason, /before the client aborted/);
        assert.equal(fs.existsSync(answeredPath(d, 'g6')), false);
        assert.equal(admitRun(d.evidenceDir).admitted, false);
    });
    it('INVALID answer evidence: an ambiguous result is not an answer, and a hand-written answered record is refused on read', async () => {
        const d = dirs();
        const create = guarded({ transport: 'ambiguous' });
        await nightlyRun(d, 'g7', { create });
        assert.equal(create.results[0].answered, false);
        assert.match(create.results[0].reason, /not a terminal outcome/);
        fs.writeFileSync(answeredPath(d, 'g7'), JSON.stringify({ runId: 'g7', result: { outcome: 'refused', status: 422 } }));
        const forged = admitRun(d.evidenceDir);
        assert.equal(forged.admitted, false);
        assert.ok(forged.blocking.some((b) => /answer evidence not valid \(the result is not bound to this attempt/.test(b)));
    });
    it('a validated refused result needs no account cleanup: the attempt clears even though nothing was created', async () => {
        const d = dirs();
        await nightlyRun(d, 'g8', { create: guarded({ transport: 'refused' }) });
        assert.equal(JSON.parse(fs.readFileSync(answeredPath(d, 'g8'), 'utf8')).result.outcome, 'refused');
        assert.equal(admitRun(d.evidenceDir).blocking.some((b) => b.includes('.attempt.')), false);
    });
    it('recovery: no documented server deadline, so a lookup alone never readmits; an authoritative terminal result must be valid and complete', async () => {
        const d = dirs();
        await nightlyRun(d, 'g5', { create: guarded({ transport: 'lost' }) }).catch(() => undefined);
        recordRecovery(d.evidenceDir, 'g5', 'unit-run-recovery');
        const sent = sentOf(d, 'g5');
        const after = (ms) => new Date(Date.parse(sent.recordedAt) + ms).toISOString();
        const residue = (over = {}) => ({ lookupRef: sent.lookupRef, observedAt: after(1), queries: [{ kind: 'account', scope: sent.lookupRef, count: 0 }],
            residueChecks: 22, residueNonZero: 0, ...over });
        const terminal = (over = {}) => ({ attemptId: sent.attemptId, lookupRef: sent.lookupRef, outcome: 'created', accountRef: 'acct-server-unit',
            receivedAt: after(1), beforeAbort: true, ...over });
        const tryRecover = (proof, opts) => recordAttemptRecovery(d.evidenceDir, 'g5', sent.attemptId, proof, opts);
        // No documented server-enforced deadline (production): a lookup-only proof is refused however late it is.
        assert.throws(() => tryRecover({ kind: 'after-server-deadline', residue: residue({ observedAt: after(24 * 3600_000) }) }), /no server-enforced deadline is documented/);
        // A bare or unknown proof, a wrong account, an invalid terminal result.
        assert.throws(() => tryRecover({ lookupRef: sent.lookupRef }), /neither an authoritative terminal result/);
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal({ lookupRef: 'acct-other' }) }), /not bound to this attempt/);
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal({ beforeAbort: false }) }), /may still complete/);
        // A created terminal result also needs complete zero residue for that account: missing, incomplete, future, nonzero.
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal() }), /no residue lookup/);
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal(), residue: residue({ residueChecks: 21 }) }), /incomplete/);
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal(), residue: residue({ observedAt: new Date(Date.now() + 3600_000).toISOString() }) }), /future time/);
        assert.throws(() => tryRecover({ kind: 'terminal', result: terminal(), residue: residue({ queries: [{ kind: 'account', scope: sent.lookupRef, count: 1 }] }) }), /zero count/);
        assert.equal(admitRun(d.evidenceDir).admitted, false, 'every refused proof left admission closed');
        tryRecover({ kind: 'terminal', result: terminal(), residue: residue() });
        assert.equal(admitRun(d.evidenceDir).admitted, true, 'an authoritative created result plus complete zero residue readmits');
    });
    it('DELAYED create after a zero lookup: with a documented server deadline, a lookup before it is refused; after it, accepted', async () => {
        const d = dirs();
        await nightlyRun(d, 'g9', { create: guarded({ transport: 'lost' }) }).catch(() => undefined);
        recordRecovery(d.evidenceDir, 'g9', 'unit-run-recovery');
        const sent = sentOf(d, 'g9');
        const deadline = { ms: 600_000, source: 'unit-test documented server deadline (not production)' };
        const at = (ms) => new Date(Date.parse(sent.recordedAt) + ms).toISOString();
        const residue = (observedAt) => ({ lookupRef: sent.lookupRef, observedAt, queries: [{ kind: 'account', scope: sent.lookupRef, count: 0 }], residueChecks: 22, residueNonZero: 0 });
        const opts = { serverDeadline: deadline, now: Date.parse(sent.recordedAt) + 3600_000 };
        assert.throws(() => recordAttemptRecovery(d.evidenceDir, 'g9', sent.attemptId, { kind: 'after-server-deadline', residue: residue(at(599_999)) }, opts),
            /before the server-enforced deadline, so a delayed create could still land/);
        recordAttemptRecovery(d.evidenceDir, 'g9', sent.attemptId, { kind: 'after-server-deadline', residue: residue(at(600_000)) }, opts);
        assert.equal(admitRun(d.evidenceDir, opts).admitted, true, 'after the documented deadline, a complete zero readmits');
        assert.equal(admitRun(d.evidenceDir).admitted, false, 'without a documented deadline (production), the same record stays blocked');
    });
});
