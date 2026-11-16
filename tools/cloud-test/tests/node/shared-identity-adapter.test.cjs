'use strict';
// integration limit: the shared-boundary inputs through the ACTUAL campaign-runner adapter (createAdapter), not hand-built io.
// Only the child-process runner is injected (as campaign-adapter.test.cjs does): admission writes the admitted ledger identity it really
// initializes, identity-check runs the REAL runIdentity in-process with a fake curl transport, and the case command writes run-guarded's
// summary. The cleanup record's field set is read from run-guarded.cjs and campaign-runner.cjs SOURCE, so producer and consumer cannot drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const B = path.join(__dirname, '..', '..', 'harness', 'bundle');
const { createAdapter } = require(path.join(B, 'harness', 'campaign-runner.cjs'));
const { runIdentity } = require(path.join(B, 'harness', 'identity-check.cjs'));
const { Ledger } = require(path.join(B, 'harness', 'campaign-ledger.cjs'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const sha = 'b'.repeat(40);

// run-guarded's cleanupEvidence keys, read from its source object literal
function producerKeys() {
  const src = fs.readFileSync(path.join(B, 'harness', 'run-guarded.cjs'), 'utf8');
  const lit = src.slice(src.indexOf('res.cleanupEvidence = {'), src.indexOf('};', src.indexOf('res.cleanupEvidence = {')));
  return [...lit.matchAll(/([A-Za-z]+):/g)].map(m => m[1]).filter(k => k !== 'res').sort();
}
function consumerKeys() {
  const src = fs.readFileSync(path.join(B, 'harness', 'campaign-runner.cjs'), 'utf8');
  return JSON.parse(/CE_KEYS=(\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
}

function fixture(t, summaryFor) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shared-identity-adapter-')));
  fs.chmodSync(root, 0o700); fs.chownSync(root, process.getuid(), process.getgid());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const driverFile = path.join(root, 'driver.cjs'), configFile = path.join(root, 'case.json'), admissionConfigFile = path.join(root, 'admission.json'),
        stepManifestFile = path.join(root, 'review.json'), runtimeQualification = path.join(root, 'runtime-qualification.json');
  const code = "module.exports=async()=>{throw Error('No step execution authorized by this unit test')};module.exports.preflight=async()=>{};module.exports.contract={requiredOracles:[]};";
  fs.writeFileSync(driverFile, code, { mode: 0o600 });
  const cfg = { checkoutDir: '/unit/checkout', campaignId: 'UNIT-NOT-A-RUN', sourceSha: sha, expectedServedSha: sha, identityCap: 18, approvedDeadlineAt: '2026-10-27T13:00:00Z',
                identityLedger: path.join(root, 'identity'), campaignLedger: path.join(root, 'ledger'), policyFile: path.join(root, 'policy.json'), securityApprovalFile: path.join(root, 'security.json') };
  fs.writeFileSync(cfg.policyFile, '{}'); fs.writeFileSync(cfg.securityApprovalFile, '{}');
  fs.writeFileSync(admissionConfigFile, JSON.stringify(cfg), { mode: 0o600 });
  fs.writeFileSync(stepManifestFile, JSON.stringify({ version: 1, scope: 'trusted-reviewed-node-not-sandbox', reviewer: 'UNIT ONLY not approval', reviewedAt: '2026-10-27T12:00:00Z', steps: [{ path: 'driver.cjs', sha256: hash(code), dependencies: [] }] }), { mode: 0o600 });
  const codeManifestSha256 = hash(fs.readFileSync(path.join(B, 'CODE.sha256')));
  const plan = { campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app/', identityCap: 18, deadlineAt: cfg.approvedDeadlineAt,
    identityLedger: cfg.identityLedger, campaignLedger: cfg.campaignLedger, admissionConfigFile, admissionConfigSha256: hash(fs.readFileSync(admissionConfigFile)), stepRoot: root, stepManifestFile,
    stepManifestSha256: hash(fs.readFileSync(stepManifestFile)), runRoot: root, cleanupReserveMs: 1000, requestSha256: '1'.repeat(64), executionIdentity: { runId: '41325698722', attempt: 1 },
    consumedPlanSha256: '2'.repeat(64), runIdentity: { runner: { codeManifestSha256 }, frontend: { sourceSha: sha }, cases: {} } };
  fs.writeFileSync(configFile, JSON.stringify({ caseId: 'AHT-01', campaignId: cfg.campaignId, sourceSha: sha, servedSha: sha, targetUrl: 'https://speaksharp-public.vercel.app', requiredAssertions: ['unit-not-live'], credentialVars: { email: 'THROWAWAY_TEST_EMAIL', password: 'THROWAWAY_TEST_PASSWORD' } }), { mode: 0o600 });
  const c = { id: 'AHT-01', driverFile, driverSha256: hash(code), configFile, configSha256: hash(fs.readFileSync(configFile)), maxMs: 1000 };
  plan.cases = [c];
  const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + sha + '"};</script></html>';
  const commandRunner = async (_node, args) => {
    if (args[0].endsWith('admission.cjs')) {
      const out = args[args.indexOf('--out') + 1]; fs.mkdirSync(out, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(out, 'browser.json'), '{}', { mode: 0o600 }); fs.writeFileSync(runtimeQualification, '{}', { mode: 0o600 });
      const campaignLedgerIdentity = Ledger.initialize(plan.campaignLedger, { total: 500 });
      fs.writeFileSync(path.join(out, 'admission-receipt.json'), JSON.stringify({ result: 'ADMISSION PASS', runtimeQualificationReceipt: runtimeQualification, binding: { campaignLedgerIdentity } }), { mode: 0o600 });
      return { status: 0, stdout: '', stderr: '', cleanupIncomplete: false };
    }
    if (args[0].endsWith('identity-check.cjs')) {
      const at = k => args[args.indexOf(k) + 1];
      const r = runIdentity({ ledger: at('--ledger'), binding: { url: at('--url'), expectedSha: at('--expect-sha'), cap: Number(at('--cap')), phase: at('--phase') } },
        (_cmd, a) => { fs.writeFileSync(a[a.indexOf('--output') + 1], body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) }; });
      return { status: r.exitCode, stdout: JSON.stringify(r.receipt) + '\n', stderr: '', cleanupIncomplete: false };
    }
    const runDir = args[args.indexOf('--run-dir') + 1];
    fs.writeFileSync(path.join(runDir, 'case-result.json'), JSON.stringify({ assertions: [] }), { mode: 0o600 });
    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summaryFor()), { mode: 0o600 });
    return { status: 0, stdout: '', stderr: '', cleanupIncomplete: false };
  };
  const io = createAdapter(plan, B, { executeR0: false, commandRunner });
  return { io, plan, c };
}
const POSITIVE = { schema: 'speaksharp.cloud-test.case-cleanup-evidence.v1', ownedProcessesRemaining: 0, launchCleanupFailure: false,
  mediaCleanupFailure: false, stopError: false, browserCloseError: false, guardClosed: true };
const summary = ce => () => ({ ownedProcessesRemaining: [], reason: 'complete', endedAt: '2026-11-01T17:00:00Z', ...(ce === undefined ? {} : { cleanupEvidence: ce }) });

test('the cleanup record run-guarded produces has exactly the field set the adapter accepts', () => {
  assert.deepEqual(producerKeys(), consumerKeys());
  assert.deepEqual(Object.keys(POSITIVE).sort(), consumerKeys());
});

test('actual adapter: admission binds the admitted ledger, identity reads charge the real ledger once each, runCase returns the exact cleanup record', async t => {
  const f = fixture(t, summary(POSITIVE));
  await f.io.preflightCase(f.c);
  const admission = await f.io.admit();
  const snap = f.io.ledgerSnapshot(admission.binding.campaignLedgerIdentity);
  assert.equal(snap.ok, true);
  const a = await f.io.identity('after-AHT-01');
  assert.deepEqual([a.result, a.reservation, a.url, a.expectedSha], ['MATCH', 1, f.plan.targetUrl, f.plan.servedSha]);
  const ran = await f.io.runCase(f.c, f.plan, admission);
  assert.deepEqual(ran.cleanupEvidence, { ...POSITIVE, cleanupIncomplete: false });
  const t0 = f.io.monotonicMs(); assert.ok(Number.isSafeInteger(t0) && f.io.monotonicMs() >= t0);
  assert.deepEqual(f.io.ledgerSnapshot({ ...admission.binding.campaignLedgerIdentity, instanceId: '00000000-0000-4000-8000-000000000000' }),
                   { ok: false, reason: 'ledger-instance-differs' });
});

test('actual adapter: a missing, partial, extended or mistyped cleanup record is no evidence (null)', async t => {
  const { schema: _s, ...noSchema } = POSITIVE;
  for (const [name, ce] of [['absent', undefined], ['partial', noSchema], ['extra key', { ...POSITIVE, extra: true }],
                            ['mistyped', { ...POSITIVE, guardClosed: 'true' }], ['negative count', { ...POSITIVE, ownedProcessesRemaining: -1 }]]) {
    const f = fixture(t, summary(ce));
    await f.io.preflightCase(f.c);
    const admission = await f.io.admit();
    assert.equal((await f.io.runCase(f.c, f.plan, admission)).cleanupEvidence, null, name);
  }
});
