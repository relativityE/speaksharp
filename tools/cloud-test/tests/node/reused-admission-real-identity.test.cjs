'use strict';
// R10 run 42423408284 : admission PASSED and GO, then the campaign refused in ~0.2 s. The A7 identityReceipt admission keeps
// is identity-check.cjs's PRINTED object, which lacked the ledger's reservation and endedAt; campaign reuse (validateReusedAdmission)
// requires both, so a real admission could never be reused. The adapter test fabricated those fields, which is how this was missed.
// Here the receipt comes from the REAL identity-check (fake transport only, no network) and goes through the REAL reuse validator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { runIdentity } = require(path.join(H, 'identity-check.cjs'));
const { validateReusedAdmission } = require(path.join(H, 'campaign-runner.cjs'));

const SHA = '5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2';
const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + SHA + '"};</script></html>';
const STEPS = ['A0.config', 'A1.bundle', 'A2.source', 'A3.tools', 'A4.credentials', 'A5.browser', 'A6.guard-selftest', 'A7.identity'];

function privateDir(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reuse-identity-')));
  fs.chmodSync(d, 0o700); fs.chownSync(d, process.getuid(), process.getgid());
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function plan(dir) {
  return { campaignId: 'R10-3b040043-smoke15', campaignLedger: path.join(dir, 'campaign-ledger.json'), identityLedger: path.join(dir, 'ledgers', 'identity-ledger.json'),
    identityCap: 32, sourceSha: SHA, servedSha: SHA, deadlineAt: '2026-11-07T23:41:42Z' };
}
// The admission receipt exactly as admission-core composes it: identityReceipt = the helper's printed last line.
function admission(p, identityReceipt) {
  return { schemaVersion: 3, result: 'ADMISSION PASS', endedAt: '2026-11-07T23:11:35.195Z', identityDispatch: 'MATCH', productionTrafficSent: 1,
    steps: STEPS.map(id => ({ id, result: 'PASS' })),
    binding: { campaignId: p.campaignId, campaignLedger: path.resolve(p.campaignLedger), identityLedger: path.resolve(p.identityLedger), identityCap: p.identityCap,
      sourceSha: p.sourceSha, servedSha: p.servedSha, approvedDeadlineAt: p.deadlineAt }, identityReceipt };
}

test('the real A7 identity receipt (as admission keeps it) is accepted by the real campaign reuse validator', t => {
  const dir = privateDir(t), p = plan(dir);
  fs.mkdirSync(path.dirname(p.identityLedger), { mode: 0o700 });
  const r = runIdentity({ ledger: p.identityLedger, binding: { url: 'https://speaksharp-public.vercel.app/', expectedSha: SHA, cap: 32, phase: 'admission' } },
    (_cmd, args) => { fs.writeFileSync(args[args.indexOf('--output') + 1], body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) }; });
  assert.equal(r.exitCode, 0);
  const printed = JSON.parse(JSON.stringify(r.receipt));          // what main() prints and admission-core JSON.parses
  assert.equal(printed.reservation, 1);
  assert.ok(Number.isFinite(Date.parse(printed.endedAt)) && Number.isFinite(Date.parse(printed.startedAt)));
  const stored = JSON.parse(fs.readFileSync(p.identityLedger, 'utf8')).receipts[0];
  assert.deepEqual(printed, stored);                               // the printed record IS the ledger's completed record, nothing invented
  assert.equal(validateReusedAdmission(admission(p, printed), p).result, 'ADMISSION PASS');
});

test('control: the receipt run 42423408284 actually emitted (no reservation, no endedAt) is still refused, in the same order', () => {
  const p = plan('/tmp/x');
  const emitted = { result: 'MATCH', reason: null, http: 200, redirects: 0, bytes: 2487, markerCount: 1, servedSha: SHA, expectedSha: SHA,
    bodySha256: '9b318ee1d22c3ca0e31e3efa6e3362f0d351d85411d3f20a0a0ec4f3398558cb', evidenceScope: 'inert-text-marker-only', phase: 'admission',
    url: 'https://speaksharp-public.vercel.app/', identityGetsUsed: 1, cap: 32 };
  assert.throws(() => validateReusedAdmission(admission(p, emitted), p), /not the first exact served-release read/);
  assert.throws(() => validateReusedAdmission(admission(p, { ...emitted, reservation: 1 }), p), /completion time invalid/);
  assert.throws(() => validateReusedAdmission(admission(p, { ...emitted, reservation: 2, endedAt: '2026-11-07T23:11:35Z' }), p), /first exact served-release read/);
});
