'use strict';
// #1884 step 6 (stub half): the guarded J4.a route (former AHT-05: save request lost, Retry, saved once) through the REAL
// harness runner (`campaign-core.runCampaign`, unmodified) and runner-bridge.cjs, offline. The case is a stub that holds the
// exact `opts.nightly` contract the real harness entry point must use: one guarded account create (reserved, recorded
// durably before it is sent, never retried), every Start press and coaching request reserved before it leaves, the created
// account recorded before its send, and run-owned cleanup with a zero-residue query. No browser, network or production.
// The real harness entry point wiring (sends routed through `opts.nightly`) is step 6's other half and is not proven here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { IDS, runCampaign } = require('../../harness/bundle/harness/campaign-core.cjs');
const { admitRun } = require('../cleanup-evidence.cjs');
const { legById, rowsForLeg } = require('../journey-plan.cjs');
const { legsForCase } = require('../case-results.cjs');
const { casesForLegs, nightlyAdapter } = require('../runner-bridge.cjs');

const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const NOW = Date.parse('2026-11-16T12:00:00Z');
const LEG = 'J4.a';
const CASE = 'AHT-05';
const POSITIVE = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false, mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true, cleanupIncomplete: false };
// The lookup reference is the reservation email's local part, as guarded-signup.cjs passes it (refs carry no '@').
const ACCOUNT = 'rwt-journey-j4a-unit';

function campaignPlan(legs) {
    return {
        version: 1, campaignId: 'UNIT-J4A-NOT-A-RUN', runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
        sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
        stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
        deadlineAt: '2026-11-16T14:00:00Z', cleanupReserveMs: 1000,
        cases: IDS.map((id) => ({ id, driverFile: `${id}.cjs`, driverSha256: hash, configFile: `${id}.json`, configSha256: hash, maxMs: 100 })),
        selection: { ids: casesForLegs(legs), ownerApprovalReference: 'unit-offline-proof-not-a-run', reason: 'J4.a guarded route offline proof' },
    };
}

/** The raw row ids AHT-05 reports for J4.a (its own rows and the invariants). */
const rows = [...new Set(legsForCase(CASE).flatMap((l) => rowsForLeg(l))
    .filter((r) => r.startsWith(`${CASE}:`) || r.startsWith('invariant:')).map((r) => r.split(':')[1]))];

/**
 * A stub AHT-05 case that sends only through `nightly`. `s`: starts, coaching, create ('created' | 'lost'), createTimes,
 * skipCreate, omitTeardown, skipVerify, residue, harnessAdmission ('refuse').
 */
function stubIo(s, wire, evidenceDir) {
    const calls = [];
    const transportCalls = [];
    const attemptsOnDisk = () => fs.readdirSync(evidenceDir).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')).length;
    return {
        calls, transportCalls,
        now: () => NOW,
        save: async () => {},
        preflightCase: async () => {},
        admit: async () => {
            calls.push('admit');
            if (s.harnessAdmission === 'refuse') throw new Error('ADMISSION REFUSED (unit: harness admission)');
            return { result: 'ADMISSION PASS' };
        },
        identity: async (phase) => { calls.push(`identity:${phase}`); return { result: 'MATCH', servedSha: phase === s.wrongReleaseAt ? 'c'.repeat(40) : commit }; },
        caseConfig: async (c) => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: rows }),
        runCase: async (c, _plan, _admission, { nightly }) => {
            calls.push(`run:${c.id}`);
            const leg = nightly.legs[0];
            const results = [];
            if (!s.skipCreate) {
                const transport = async function (arg) {
                    transportCalls.push({ attemptRecordedBeforeSend: attemptsOnDisk() > 0, retries: arg.retries, signalIsAbortSignal: arg.signal instanceof AbortSignal });
                    wire.push('create:account');
                    if (s.create === 'lost') throw new Error('response lost after send');
                    return { outcome: 'created', accountRef: 'acct-server-unit' };
                };
                for (let i = 0; i < (s.createTimes ?? 1); i += 1)
                    results.push(await nightly.createAccount(leg, ACCOUNT, transport).catch((e) => ({ threw: e.message })));
                if (results[0]?.threw) throw new Error(`the guarded create did not return: ${results[0].threw}`);
            }
            if (s.recordSession) nightly.created(leg, { kind: 'session', ref: 'take-unit-1' });
            const refused = [];
            for (let i = 0; i < (s.starts ?? 2); i += 1) {
                const r = await nightly.send(leg, 'starts', async () => wire.push('starts'));
                if (!r.sent) refused.push('starts');
            }
            for (let i = 0; i < (s.coaching ?? 2); i += 1) {
                const r = await nightly.send(leg, 'coaching', async () => wire.push('coaching'));
                if (!r.sent) refused.push('coaching');
            }
            const del = await nightly.cleanup(leg, async () => { wire.push('cleanup:delete-account'); return true; });
            const query = s.skipVerify ? { sent: false } : await nightly.cleanup(leg, async () => { wire.push('cleanup:residue-query'); return s.residue ?? 0; });
            // An unrecorded take: the case saved it but never called nightly.created, and its teardown neither deletes nor
            // reports it. Only the account is queried, so the take's residue is never looked for.
            if (s.unrecordedTake) wire.push('untracked:session-left');
            return {
                assertions: rows.map((id) => ({ id, result: 'PASS', detail: 'offline stub', evidenceRefs: ['unit.json'] })),
                cleanupEvidence: POSITIVE, refused, createResults: results,
                nightlyCleanup: {
                    steps: s.omitTeardown || s.skipCreate ? [] : [{ kind: 'account', ref: ACCOUNT, action: 'delete', outcome: del.sent ? 'done' : 'not attempted' }],
                    left: s.leftUntracked ? [{ kind: 'session', ref: 'take-unit-1' }] : [],
                    ...(query.sent ? { verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: `unit-run:${c.id}`, count: query.value }] } } : {}),
                },
            };
        },
    };
}

const dirs = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-j4a-'));
    const evidenceDir = path.join(root, 'evidence');
    fs.mkdirSync(evidenceDir);
    return { root, evidenceDir, runDir: (runId) => path.join(root, `run-${runId}`) };
};
async function j4aRun(d, runId, scenario = {}) {
    const wire = [];
    const raw = stubIo(scenario, wire, d.evidenceDir);
    const { io, outcome, finish } = nightlyAdapter(raw, { runDir: d.runDir(runId), evidenceDir: d.evidenceDir, runId, selected: [LEG], satisfiedGates: [], coachingCeiling: scenario.coachingCeiling });
    const r = await runCampaign(campaignPlan([LEG]), io, { executeR0: true });
    await finish(r.report);
    return { r, wire, calls: raw.calls, transportCalls: raw.transportCalls, outcome: outcome(), report: r.report };
}
const journal = (d, runId) => fs.readFileSync(path.join(d.runDir(runId), 'budget-journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('J4.a guarded route (#1884 step 6, stub): AHT-05 through the real harness runner, offline', () => {
    it('plan: J4.a is AHT-05, ungated, with 1 signup, 2 Start presses and 2 coaching requests', () => {
        const leg = legById(LEG);
        assert.equal(leg.caseId, CASE);
        assert.deepEqual(leg.gates, []);
        assert.deepEqual(casesForLegs([LEG]), [CASE]);
    });
    it('PASS path: one guarded create recorded before it is sent, never retried; every send reserved; cleanup verified', async () => {
        const d = dirs();
        const { wire, calls, transportCalls, outcome, report } = await j4aRun(d, 'p1');
        assert.deepEqual(calls.filter((c) => c.startsWith('run:')), [`run:${CASE}`]);
        assert.deepEqual(wire, ['create:account', 'starts', 'starts', 'coaching', 'coaching', 'cleanup:delete-account', 'cleanup:residue-query']);
        assert.equal(transportCalls.length, 1);
        assert.deepEqual(transportCalls[0], { attemptRecordedBeforeSend: true, retries: 0, signalIsAbortSignal: true });
        const grants = journal(d, 'p1').filter((e) => e.t === 'grant');
        assert.equal(grants.length, wire.length, 'one granted reservation per send, the create included');
        assert.equal(outcome.legs[LEG].outcome, 'PASS');
        assert.equal(outcome.cleanup.result, 'complete');
        assert.equal(report.nightly.run.scope.outcome, 'PASS');
        assert.equal(admitRun(d.evidenceDir).admitted, true, 'verified cleanup admits the next run');
    });
    it('no write before admission: a refused budget or a refused harness admission sends nothing, creates nothing', async () => {
        for (const [label, scenario] of [['coaching ceiling below the leg\'s need', { coachingCeiling: 1 }], ['harness admission refused', { harnessAdmission: 'refuse' }]]) {
            const d = dirs();
            const run = await j4aRun(d, 'a1', scenario).catch((e) => ({ threw: e.message }));
            const wire = run.wire ?? [];
            assert.deepEqual(wire, [], `${label}: nothing on the wire`);
            assert.equal((run.transportCalls ?? []).length, 0, `${label}: no account create`);
            assert.equal(fs.readdirSync(d.evidenceDir).some((n) => n.includes('.attempt.')), false, `${label}: no create attempt recorded`);
        }
    });
    it('no retry of an ambiguous create: a lost answer is sent once, never repeated, and holds admission until that account is recovered', async () => {
        const d = dirs();
        const run = await j4aRun(d, 'l1', { create: 'lost' }).catch((e) => ({ threw: e.message }));
        assert.equal(fs.readdirSync(d.evidenceDir).filter((n) => n.includes('.attempt.') && n.endsWith('.sent.json')).length, 1, 'one durable attempt, sent once');
        const next = admitRun(d.evidenceDir);
        assert.equal(next.admitted, false);
        assert.ok(next.blocking.some((b) => /no terminal result; recover that exact account first/.test(b)), JSON.stringify(next.blocking));
        assert.notEqual(run.outcome?.legs?.[LEG]?.outcome, 'PASS');
    });
    it('no second create in one journey: a repeated create is refused by the frozen signup allocation and never sent', async () => {
        const d = dirs();
        const { transportCalls, wire } = await j4aRun(d, 'c2', { createTimes: 2 });
        assert.equal(transportCalls.length, 1, 'the second create never left');
        assert.equal(wire.filter((w) => w === 'create:account').length, 1);
    });
    it('over allocation: a 3rd Start press is FAIL and never sent; cleanup still runs and verifies', async () => {
        const d = dirs();
        const { wire, outcome } = await j4aRun(d, 'o1', { starts: 3 });
        assert.equal(wire.filter((w) => w === 'starts').length, 2);
        assert.deepEqual(wire.slice(-2), ['cleanup:delete-account', 'cleanup:residue-query']);
        assert.equal(outcome.legs[LEG].outcome, 'FAIL');
        assert.equal(outcome.cleanup.result, 'complete');
    });
    it('wrong release before the case: nothing is sent, no account is created, and the leg is not PASS', async () => {
        const d = dirs();
        const run = await j4aRun(d, 'w1', { wrongReleaseAt: `before-${CASE}` }).catch((e) => ({ threw: e.message }));
        assert.deepEqual(run.wire ?? [], [], JSON.stringify(run.threw ?? run.calls));
        assert.equal((run.transportCalls ?? []).length, 0);
        assert.notEqual(run.outcome?.legs?.[LEG]?.outcome, 'PASS');
        assert.notEqual(run.report?.nightly?.run?.scope?.outcome, 'PASS');
    });
    it('wrong release after the case or at the campaign end: the leg PASS becomes HOLD and the scope is not PASS', async () => {
        for (const phase of [`after-${CASE}`, 'campaign-end']) {
            const { outcome, report } = await j4aRun(dirs(), 'w2', { wrongReleaseAt: phase });
            assert.equal(outcome.legs[LEG].outcome, 'HOLD', `${phase}: ${outcome.legs[LEG].reason}`);
            assert.notEqual(report.nightly.run.scope.outcome, 'PASS', phase);
        }
    });
    it('tracked resource: a recorded take (session) with no completed teardown step and no session residue query is incomplete', async () => {
        const d = dirs();
        const { outcome } = await j4aRun(d, 't1', { recordSession: true });
        assert.equal(outcome.cleanup.result, 'incomplete');
        assert.ok(outcome.cleanup.reasons.J4.some((r) => r.includes('created session take-unit-1 has no completed cleanup step')), JSON.stringify(outcome.cleanup.reasons));
        assert.ok(outcome.cleanup.reasons.J4.some((r) => r.includes('no residue query for session')));
    });
    it('a resource the teardown reports left behind (even one the runner never recorded) is incomplete and refuses the next run', async () => {
        const d = dirs();
        const first = await j4aRun(d, 't2', { leftUntracked: true });
        assert.equal(first.outcome.cleanup.result, 'incomplete');
        assert.ok(first.outcome.cleanup.reasons.J4.some((r) => r.includes('left behind')), JSON.stringify(first.outcome.cleanup.reasons));
        assert.equal((await j4aRun(d, 't3')).outcome.admitted, false);
    });
    // Sam, 16 Nov (#1884): J4 cleanup must run post-cleanup account, session and lease queries scoped to the run-owned
    // account, whatever the case recorded. RED until that rule lands in cleanup-plan.cjs / cleanup-evidence.cjs; ship together.
    it('an unrecorded take: account-only residue proof cannot make J4 cleanup complete (required account, session, lease queries)', async () => {
        const d = dirs();
        const { outcome, wire } = await j4aRun(d, 'u1', { unrecordedTake: true });
        assert.ok(wire.includes('untracked:session-left'), 'the stub left a take it never recorded');
        assert.equal(outcome.cleanup.result, 'incomplete');
        for (const kind of ['session', 'lease'])
            assert.ok(outcome.cleanup.reasons.J4.some((r) => r.includes(kind)), `${kind}: ${JSON.stringify(outcome.cleanup.reasons)}`);
        assert.equal((await j4aRun(d, 'u2')).outcome.admitted, false, 'the next run is refused');
    });
    it('cleanup controls: an omitted teardown of the created account, a missing residue query or residue found is incomplete and refuses the next run', async () => {
        for (const [label, scenario, reason] of [
            ['teardown omits the created account', { omitTeardown: true }, `created account ${ACCOUNT} has no completed cleanup step`],
            ['no residue query', { skipVerify: true }, 'no residue verification'],
            ['residue query found one', { residue: 1 }, 'found 1'],
        ]) {
            const d = dirs();
            const first = await j4aRun(d, 'k1', scenario);
            assert.equal(first.outcome.cleanup.result, 'incomplete', label);
            assert.ok(first.outcome.cleanup.reasons.J4.some((r) => r.includes(reason)), `${label}: ${JSON.stringify(first.outcome.cleanup.reasons)}`);
            const next = await j4aRun(d, 'k2');
            assert.equal(next.outcome.admitted, false, `${label}: the next run is refused`);
            assert.deepEqual(next.wire, [], `${label}: the refused run sent nothing`);
        }
    });
});
