'use strict';
// #1884: the J4.a binding through the ACTUAL campaign-runner adapter (createAdapter().runCase) and the ACTUAL supervisedCommand
// (admission.cjs) with its IPC option. Only the supervised script is swapped for a stand-in that runs the supervisor's own pre-launch
// (bindSupervisedChild) with run-guarded's real argument vector. Offline: fake transports, no browser, network or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const B = path.join(__dirname, '..', '..', 'harness', 'bundle');
const { createAdapter } = require(path.join(B, 'harness', 'campaign-runner.cjs'));
const { supervisedCommand } = require(path.join(B, 'harness', 'admission.cjs'));
const { runIdentity } = require(path.join(B, 'harness', 'identity-check.cjs'));
const { Ledger } = require(path.join(B, 'harness', 'campaign-ledger.cjs'));
const STORES = require('../residue-inventory.cjs').j4aRequiredStores();
const CHILD = path.join(__dirname, 'fixtures', 'j4a-guarded-child.cjs');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha = 'b'.repeat(40);
const ACCOUNT = 'j4a-unit-account';

function fakeNightly(calls) {
    const route = (name) => async (...args) => { calls.push(name); const fn = args[args.length - 1]; return { sent: true, value: await fn() }; };
    return {
        send: async (leg, kind, fn) => { calls.push(`send:${leg}:${kind}`); return { sent: true, value: await fn() }; },
        cleanup: async (leg, fn) => { calls.push(`cleanup:${leg}`); return { sent: true, value: await fn() }; },
        createAccount: async (leg, ref, fn) => { calls.push(`create:${leg}:${ref}`); return { sent: true, answered: true, value: await fn({ signal: new AbortController().signal, retries: 0 }) }; },
        created: route('created'),
    };
}

/** `childCase` lets a test hand the child a DIFFERENT case config than the one the parent planned (a wrong-release child). */
function fixture(t, { childCase } = {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-supervised-adapter-')));
    fs.chmodSync(root, 0o700);
    const checkout = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j4a-supervised-checkout-')));
    t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(checkout, { recursive: true, force: true }); });
    const driverFile = path.join(root, 'driver.cjs'), configFile = path.join(root, 'case.json'), admissionConfigFile = path.join(root, 'admission.json'),
        stepManifestFile = path.join(root, 'review.json'), runtimeQualification = path.join(root, 'runtime-qualification.json');
    const code = "module.exports=async()=>{throw Error('no step execution in this unit test')};module.exports.preflight=async()=>{};module.exports.contract={requiredOracles:[]};";
    fs.writeFileSync(driverFile, code, { mode: 0o600 });
    const cfg = { checkoutDir: checkout, campaignId: 'UNIT-NOT-A-RUN', sourceSha: sha, expectedServedSha: sha, identityCap: 18, approvedDeadlineAt: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        identityLedger: path.join(root, 'identity'), campaignLedger: path.join(root, 'ledger'), policyFile: path.join(root, 'policy.json'), securityApprovalFile: path.join(root, 'security.json') };
    fs.writeFileSync(cfg.policyFile, '{}'); fs.writeFileSync(cfg.securityApprovalFile, '{}');
    fs.writeFileSync(admissionConfigFile, JSON.stringify(cfg), { mode: 0o600 });
    fs.writeFileSync(stepManifestFile, JSON.stringify({ version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'UNIT ONLY not approval', reviewedAt: '2026-10-27T12:00:00Z', steps: [{ path: 'driver.cjs', sha256: hash(code), dependencies: [] }] }), { mode: 0o600 });
    const plan = { campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app/', identityCap: 18, deadlineAt: cfg.approvedDeadlineAt,
        identityLedger: cfg.identityLedger, campaignLedger: cfg.campaignLedger, admissionConfigFile, admissionConfigSha256: hash(fs.readFileSync(admissionConfigFile)), stepRoot: root, stepManifestFile,
        stepManifestSha256: hash(fs.readFileSync(stepManifestFile)), runRoot: root, cleanupReserveMs: 1000, requestSha256: '1'.repeat(64), executionIdentity: { runId: '41325698722', attempt: 1 },
        consumedPlanSha256: '2'.repeat(64), runIdentity: { runner: { codeManifestSha256: hash(fs.readFileSync(path.join(B, 'CODE.sha256'))) }, frontend: { sourceSha: sha }, cases: {} } };
    const caseJson = { caseId: 'AHT-05', campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: ['unit-not-live'], credentialVars: { email: 'THROWAWAY_TEST_EMAIL', password: 'THROWAWAY_TEST_PASSWORD' } };
    fs.writeFileSync(configFile, JSON.stringify(caseJson), { mode: 0o600 });
    const c = { id: 'AHT-05', driverFile, driverSha256: hash(code), configFile, configSha256: hash(fs.readFileSync(configFile)), maxMs: 8000 };
    plan.cases = [c];
    const wireFile = path.join(root, 'wire.log'), dbFile = path.join(root, 'db.json');
    fs.writeFileSync(wireFile, ''); fs.writeFileSync(dbFile, JSON.stringify({ account: {}, session: {}, lease: {} }));
    const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + sha + '"};</script></html>';
    const caseArgv = [];
    const commandRunner = async (node, args, options, deps) => {
        if (args[0].endsWith('admission.cjs')) {
            const out = args[args.indexOf('--out') + 1]; fs.mkdirSync(out, { recursive: true, mode: 0o700 });
            fs.writeFileSync(path.join(out, 'browser.json'), '{}', { mode: 0o600 }); fs.writeFileSync(runtimeQualification, '{}', { mode: 0o600 });
            const campaignLedgerIdentity = Ledger.initialize(plan.campaignLedger, { total: 500 });
            fs.writeFileSync(path.join(out, 'admission-receipt.json'), JSON.stringify({ result: 'ADMISSION PASS', runtimeQualificationReceipt: runtimeQualification, binding: { campaignLedgerIdentity } }), { mode: 0o600 });
            return { status: 0, stdout: '', stderr: '', cleanupIncomplete: false };
        }
        if (args[0].endsWith('identity-check.cjs')) {
            const at = (k) => args[args.indexOf(k) + 1];
            const r = runIdentity({ ledger: at('--ledger'), binding: { url: at('--url'), expectedSha: at('--expect-sha'), cap: Number(at('--cap')), phase: at('--phase') } },
                (_cmd, x) => { fs.writeFileSync(x[x.indexOf('--output') + 1], body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) }; });
            return { status: r.exitCode, stdout: JSON.stringify(r.receipt) + '\n', stderr: '', cleanupIncomplete: false };
        }
        assert.ok(args[0].endsWith(path.join('harness', 'run-guarded.cjs')), 'the case command is the supervisor');
        caseArgv.push(...args);
        const childArgs = args.slice(1);
        if (childCase) {
            const other = path.join(root, 'child-case.json'); fs.writeFileSync(other, JSON.stringify({ ...caseJson, ...childCase }), { mode: 0o600 });
            childArgs[childArgs.indexOf('--case-config') + 1] = other;
            childArgs[childArgs.indexOf('--case-config-sha256') + 1] = hash(fs.readFileSync(other));
        }
        return supervisedCommand(node, [CHILD, ...childArgs], options, { env: { ...deps.env, PATH: process.env.PATH, J4A_WIRE: wireFile, J4A_DB: dbFile, J4A_ACCOUNT: ACCOUNT } });
    };
    const readDb = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    // One read per required store (shared inventory); the fake database models the account, its takes and its lease.
    const trustedResidue = async (store, scope) => { fs.appendFileSync(wireFile, `trusted-residue:${store}\n`); const key = { 'auth:account': 'account', 'sessions:user_id': 'session', 'active_recording_lease:user_id': 'lease' }[store]; return key ? readDb()[key][scope] ?? 0 : 0; };
    const io = createAdapter(plan, B, { executeR0: false, commandRunner, trustedResidue });
    const wire = () => fs.readFileSync(wireFile, 'utf8').trim().split('\n').filter(Boolean);
    return { io, plan, c, wire, caseArgv };
}

async function run(f, nightly) {
    await f.io.preflightCase(f.c);
    const admission = await f.io.admit();
    return f.io.runCase(f.c, f.plan, admission, nightly ? { nightly } : {});
}

test('actual adapter + supervisedCommand: the child binds its own identity before launch; counts come from the trusted reader', { timeout: 20_000 }, async (t) => {
    const f = fixture(t);
    const calls = [];
    const ran = await run(f, fakeNightly(calls));
    assert.ok(f.caseArgv.includes('--j4a-binding') && f.caseArgv.includes('--runtime-start-sha256'));
    assert.deepEqual(f.wire(), ['launch', 'create:retries=0', 'create-result:created', 'starts', 'starts', 'cleanup', 'report:accepted',
        ...STORES.map((x) => `trusted-residue:${x.id}`)]);
    assert.deepEqual(calls, [`create:J4.a:${ACCOUNT}`, 'send:J4.a:starts', 'send:J4.a:starts', ...Array(1 + STORES.length).fill('cleanup:J4.a')] /* the child's teardown, then one reserved read per required store */);
    assert.equal(ran.safetyStop, false);
    assert.equal(ran.j4aBinding.bound, true);
    assert.deepEqual(ran.j4aBinding.violations, []);
    assert.deepEqual(ran.nightlyCleanup.verification.queries.map((q) => q.store), STORES.map((x) => x.id));
    assert.ok(ran.nightlyCleanup.verification.queries.every((q) => q.scope === ACCOUNT && q.count === 0));
});

test('actual adapter + supervisedCommand: a child holding a different release refuses with 78 before launch; nothing reaches nightly', { timeout: 20_000 }, async (t) => {
    for (const childCase of [{ sourceSha: 'c'.repeat(40), servedSha: 'c'.repeat(40) }, { campaignId: 'OTHER-CAMPAIGN' }]) {
        const f = fixture(t, { childCase });
        const calls = [];
        const ran = await run(f, fakeNightly(calls));
        const w = f.wire();
        assert.equal(w.length, 1, JSON.stringify(w));
        assert.match(w[0], /^refused:J4A_BINDING_REFUSED/);
        assert.deepEqual(calls, []);
        assert.equal(ran.safetyStop, true);
        assert.equal(ran.j4aBinding.bound, false);
        assert.match(ran.reason, /J4\.a supervised binding refused/);
        assert.deepEqual(ran.nightlyCleanup, { steps: [], left: [] });
    }
});

test('actual adapter: without nightly routes the ordinary path is unchanged (no binding args, no IPC)', { timeout: 20_000 }, async (t) => {
    const f = fixture(t);
    const ran = await run(f, null);
    assert.equal(f.caseArgv.includes('--j4a-binding'), false);
    assert.deepEqual(f.wire(), ['launch']);
    assert.equal('j4aBinding' in ran, false);
    assert.equal('nightlyCleanup' in ran, false);
});
