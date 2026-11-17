'use strict';
// #1884 step 6: the supervised J4.a capability across a REAL process boundary, offline. The real harness runner
// (campaign-core.runCampaign, unmodified) and runner-bridge.cjs drive the case; the case's io spawns a separate child process
// (tests/fixtures/j4a-supervised-child.cjs) and attaches the parent end of j4a-supervised-channel.cjs with the bridge's own
// `nightly` routes. The child holds its own identity and acts only on the parent's grants, over fake bounded transports. Residue
// counts come only from the parent's trusted reader (a fake database the child's actions change), scoped to the confirmed create.
// Refusals proven: wrong identity, replay, disconnect, unreserved (over-allocation) send, ambiguous create, foreign cleanup and
// interrupted cleanup. No browser, network, production, Stripe or Edge effect; the sealed supervisor wiring is not yet attached.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { IDS, runCampaign } = require('../../harness/bundle/harness/campaign-core.cjs');
const { admitRun } = require('../cleanup-evidence.cjs');
const { rowsForLeg } = require('../journey-plan.cjs');
const { legsForCase } = require('../case-results.cjs');
const { casesForLegs, nightlyAdapter } = require('../runner-bridge.cjs');
const { attachParentChannel, validCleanupReport } = require('../j4a-supervised-channel.cjs');

const hash = 'a'.repeat(64);
const commit = 'b'.repeat(40);
const NOW = Date.parse('2026-11-17T12:00:00Z');
const LEG = 'J4.a';
const CASE = 'AHT-05';
const ACCOUNT = 'rwt-journey-j4a-unit';
const CHILD = path.join(__dirname, 'fixtures', 'j4a-supervised-child.cjs');
const POSITIVE = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false,
    mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true, cleanupIncomplete: false };
const IDENTITY = Object.freeze({ campaignId: 'UNIT-J4A-NOT-A-RUN', runId: 'unit-run', attempt: 1, caseId: CASE,
    requestSha256: '1'.repeat(64), planSha256: '2'.repeat(64), configSha256: '3'.repeat(64), sourceSha: commit, servedSha: commit });
const rows = [...new Set(legsForCase(CASE).flatMap((l) => rowsForLeg(l))
    .filter((r) => r.startsWith(`${CASE}:`) || r.startsWith('invariant:')).map((r) => r.split(':')[1]))];

function campaignPlan() {
    return {
        version: 1, campaignId: IDENTITY.campaignId, runtime: 'Claude SpeakSharp R4', targetUrl: 'https://speaksharp-public.vercel.app/', costCeilingUsd: 0,
        sourceSha: commit, servedSha: commit, admissionConfigFile: 'unit.json', admissionConfigSha256: hash, stepRoot: 'unit', stepManifestFile: 'steps.json',
        stepManifestSha256: hash, campaignLedger: 'ledger.json', identityLedger: 'identity.json', identityCap: 32, runRoot: 'unit',
        deadlineAt: '2026-11-17T14:00:00Z', cleanupReserveMs: 1000,
        cases: IDS.map((id) => ({ id, driverFile: `${id}.cjs`, driverSha256: hash, configFile: `${id}.json`, configSha256: hash, maxMs: 15_000 })),
        selection: { ids: casesForLegs([LEG]), ownerApprovalReference: 'unit-offline-proof-not-a-run', reason: 'J4.a supervised channel offline proof' },
    };
}

/** The case io: its runCase spawns the real child and attaches the parent channel to the bridge's `nightly` for this case. */
function supervisedIo({ scenario = 'ok', childIdentity = IDENTITY, wireFile, dbFile, channels }) {
    return {
        now: () => NOW,
        save: async () => {},
        preflightCase: async () => {},
        admit: async () => ({ result: 'ADMISSION PASS' }),
        identity: async () => ({ result: 'MATCH', servedSha: commit }),
        caseConfig: async (c) => ({ caseId: c.id, sourceSha: commit, servedSha: commit, targetUrl: 'https://speaksharp-public.vercel.app/', requiredAssertions: rows }),
        runCase: async (c, _plan, _admission, { nightly }) => {
            const child = spawn(process.execPath, [CHILD, JSON.stringify({ identity: childIdentity, scenario, account: ACCOUNT, wireFile, dbFile })],
                { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: {} });
            const exited = once(child, 'exit');
            const channel = attachParentChannel({ port: child, identity: IDENTITY, nightly });
            const [code] = await exited;
            // The trusted reader: the parent's own reserved cleanup reads of the fake database, never the child's claim.
            // One read per required store (the shared inventory); the fake database models the account, its takes and its lease.
            const readResidue = async (store, scope) => {
                const r = await nightly.cleanup(LEG, async () => {
                    fs.appendFileSync(wireFile, `trusted-residue:${store}\n`);
                    const key = { 'auth:account': 'account', 'sessions:user_id': 'session', 'active_recording_lease:user_id': 'lease' }[store];
                    return key ? JSON.parse(fs.readFileSync(dbFile, 'utf8'))[key][scope] ?? 0 : 0;
                });
                return r.sent ? r.value : null;
            };
            const out = await channel.outcome({ readResidue });
            channels.push(out);
            return {
                // The step's rows count only for a bound child that completed; anything else carries no PASS.
                assertions: out.digest && code === 0 ? rows.map((id) => ({ id, result: 'PASS', detail: 'offline supervised child', evidenceRefs: ['unit.json'] })) : [],
                ...(out.digest ? {} : { safetyStop: true, reason: `supervised binding refused: ${out.refused}` }),
                cleanupEvidence: POSITIVE,
                nightlyCleanup: out.nightlyCleanup,
            };
        },
    };
}

const dirs = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-j4a-supervised-'));
    const evidenceDir = path.join(root, 'evidence');
    fs.mkdirSync(evidenceDir);
    return { root, evidenceDir, runDir: (id) => path.join(root, `run-${id}`), wireFile: path.join(root, 'wire.log'), dbFile: path.join(root, 'db.json') };
};
async function supervisedRun(d, runId, opts = {}) {
    const channels = [];
    fs.writeFileSync(d.wireFile, '');
    fs.writeFileSync(d.dbFile, JSON.stringify({ account: {}, session: {}, lease: {} }));
    const raw = supervisedIo({ ...opts, wireFile: d.wireFile, dbFile: d.dbFile, channels });
    const { io, outcome, finish } = nightlyAdapter(raw, { runDir: d.runDir(runId), evidenceDir: d.evidenceDir, runId, selected: [LEG],
        satisfiedGates: [], createDeadlineMs: opts.createDeadlineMs });
    const r = await runCampaign(campaignPlan(), io, { executeR0: true }).catch((e) => ({ threw: e.message }));
    if (r.report) await finish(r.report);
    const wire = fs.readFileSync(d.wireFile, 'utf8').split('\n').filter(Boolean);
    return { wire, outcome: outcome(), report: r.report, threw: r.threw, channel: channels[0] };
}

describe('J4.a supervised channel (#1884 step 6): a real child process, the real runner and bridge, fake transports', () => {
    it('bound child: one guarded create, every send granted before it acts, verified cleanup, scope PASS, next run admitted', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome, report, channel } = await supervisedRun(d, 's1');
        assert.deepEqual(wire, ['create:account:retries=0', 'create-result:created', 'starts', 'starts', 'coaching', 'coaching',
            'cleanup:delete-account', 'report:accepted', ...require('../residue-inventory.cjs').j4aRequiredStores().map((x) => `trusted-residue:${x.id}`)]);
        assert.equal(channel.confirmedAccount, ACCOUNT);
        assert.match(channel.digest, /^[a-f0-9]{64}$/);
        assert.deepEqual(channel.violations, []);
        assert.equal(outcome.legs[LEG].outcome, 'PASS');
        assert.equal(outcome.cleanup.result, 'complete');
        assert.equal(report.nightly.run.scope.outcome, 'PASS');
        assert.equal(admitRun(d.evidenceDir).admitted, true);
    });
    it('wrong identity at the child: refused before anything is sent, no create recorded, no PASS', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome, channel } = await supervisedRun(d, 'w1', { childIdentity: { ...IDENTITY, servedSha: 'c'.repeat(40) } });
        assert.deepEqual(wire, ['refused:J4A_BINDING_REJECTED']);
        assert.equal(channel.digest, null);
        assert.equal(fs.readdirSync(d.evidenceDir).some((n) => n.includes('.attempt.')), false, 'no create attempt recorded');
        assert.notEqual(outcome.legs[LEG]?.outcome, 'PASS');
        assert.notEqual(outcome.run.scope?.outcome, 'PASS');
    });
    it('replay: a reused request id is refused and grants nothing; the duplicate never acts', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, channel } = await supervisedRun(d, 'r1', { scenario: 'replay' });
        assert.equal(wire.filter((w) => w === 'starts').length, 2, 'the replayed request did not send a third Start press');
        assert.ok(channel.violations.includes('replayed request r-2'), JSON.stringify(channel.violations));
    });
    it('unreserved send: a Start press past the frozen allocation is never granted, never acts, and the leg FAILs', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome } = await supervisedRun(d, 'o1', { scenario: 'over-send' });
        assert.equal(wire.filter((w) => w === 'starts').length, 2);
        assert.ok(wire.includes('starts:refused'));
        assert.equal(wire.filter((w) => w === 'coaching').length, 0, 'after the overrun no ordinary work leaves');
        assert.equal(outcome.legs[LEG].outcome, 'FAIL');
    });
    it('ambiguous create: sent once, never retried; a second create is refused before its transport; admission holds', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome } = await supervisedRun(d, 'a1', { scenario: 'ambiguous-create', createDeadlineMs: 500 });
        assert.equal(wire.filter((w) => w.startsWith('create:account')).length, 1);
        assert.ok(!wire.includes('create:account:SECOND'));
        assert.ok(wire.includes('second-create:refused'));
        const next = admitRun(d.evidenceDir);
        assert.equal(next.admitted, false);
        assert.ok(next.blocking.some((b) => /no terminal result; recover that exact account first/.test(b)), JSON.stringify(next.blocking));
        assert.notEqual(outcome.legs[LEG]?.outcome, 'PASS');
    });
    it('foreign cleanup: deleting another account leaves the confirmed account counted by the trusted reader; never complete', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { outcome, channel } = await supervisedRun(d, 'f1', { scenario: 'foreign-cleanup' });
        // The channel's own trusted reads are scoped to the parent-confirmed account, not the account the child deleted.
        const queries = channel.nightlyCleanup.verification.queries;
        assert.equal(queries.length, require('../residue-inventory.cjs').j4aRequiredStores().length);
        assert.ok(queries.every((q) => q.scope === ACCOUNT), 'every store read is scoped to the confirmed account');
        assert.equal(queries.find((q) => q.store === 'auth:account').count, 1, 'the confirmed account is still there');
        assert.equal(outcome.cleanup.result, 'incomplete');
        assert.ok(outcome.cleanup.reasons.J4.some((r) => /confirmed account scope/.test(r)), JSON.stringify(outcome.cleanup.reasons));
        assert.notEqual(outcome.run.scope.outcome, 'PASS');
        assert.equal(admitRun(d.evidenceDir).admitted, false);
    });
    it('interrupted cleanup: observations made before the child ended without a report do not verify cleanup', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome } = await supervisedRun(d, 'i1', { scenario: 'interrupted-cleanup' });
        assert.ok(wire.includes('cleanup:delete-account'), 'the deletion was made');
        assert.ok(!wire.some((w) => w.startsWith('report:')));
        assert.ok(!wire.some((w) => w.startsWith('trusted-residue:')), 'no report: nothing is read or credited');
        assert.equal(outcome.cleanup.result, 'incomplete');
        assert.notEqual(outcome.run.scope.outcome, 'PASS');
        assert.equal(admitRun(d.evidenceDir).admitted, false);
    });
    it('a cleanup report under a digest the parent never bound is refused and verifies nothing', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { outcome, channel } = await supervisedRun(d, 'g1', { scenario: 'forged-digest' });
        assert.ok(channel.violations.includes('cleanup report not under the bound digest'), JSON.stringify(channel.violations));
        assert.equal(outcome.cleanup.result, 'incomplete');
        assert.notEqual(outcome.run.scope.outcome, 'PASS');
    });
    it('disconnect: a request from a child that is gone cannot reach the budget; an unbound channel forwards nothing', async () => {
        const events = {};
        const sent = [];
        const port = { send: (m) => sent.push(m), on: (e, fn) => { events[e] = fn; } };
        let calls = 0;
        const nightly = new Proxy({}, { get: () => () => { calls += 1; return { sent: true }; } });
        const ch = attachParentChannel({ port, identity: IDENTITY, nightly });
        events.message({ t: 'req', id: 'r-1', op: 'send', kind: 'starts' }); // before binding
        events.disconnect();
        events.message({ t: 'req', id: 'r-2', op: 'send', kind: 'starts' }); // after the child is gone
        await new Promise((r) => { setImmediate(r); });
        assert.equal(calls, 0, 'nothing reached the nightly routes');
        assert.equal(await ch.bound, null);
        const out = await ch.outcome({ readResidue: async () => 0 });
        assert.deepEqual(out.nightlyCleanup, { steps: [], left: [] });
        assert.match(out.refused, /ended before binding/);
    });
    it('the child report carries steps only (content-free refs); any count it claims makes the report malformed', () => {
        const ok = { steps: [{ kind: 'account', ref: ACCOUNT, action: 'delete', outcome: 'done' }], left: [] };
        assert.equal(validCleanupReport(ok), true);
        for (const bad of [null, { ...ok, verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: ACCOUNT, count: 0 }] } },
            { ...ok, steps: [{ kind: 'account', ref: 'a@b', action: 'x', outcome: 'done' }] }, { steps: ok.steps }])
            assert.equal(validCleanupReport(bad), false, JSON.stringify(bad));
    });
    it('a leftover take under the confirmed account is counted by the trusted reader: cleanup incomplete, no PASS', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { outcome, channel } = await supervisedRun(d, 'l1', { scenario: 'leave-session' });
        assert.equal(channel.confirmedAccount, ACCOUNT);
        assert.equal(outcome.cleanup.result, 'incomplete');
        assert.ok(outcome.cleanup.reasons.J4.some((r) => /session/.test(r)), JSON.stringify(outcome.cleanup.reasons));
        assert.notEqual(outcome.run.scope.outcome, 'PASS');
    });
    it('a child report that claims its own zero counts is refused; counts come only from the trusted reader', { timeout: 20_000 }, async () => {
        const d = dirs();
        const { wire, outcome, channel } = await supervisedRun(d, 'c1', { scenario: 'claimed-counts' });
        assert.ok(wire.includes('report:refused'));
        assert.ok(channel.violations.includes('malformed cleanup report'), JSON.stringify(channel.violations));
        assert.equal(outcome.cleanup.result, 'incomplete');
    });
});
