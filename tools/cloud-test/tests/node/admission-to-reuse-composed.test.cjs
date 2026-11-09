'use strict';
// through the ACTUAL admission and the ACTUAL reused admit. runAdmission runs with the reviewed admission
// selftest fixture (loaded from that file, unchanged) except one thing: its A7 identity command is the REAL identity-check helper (fake
// curl transport only, real private ledger). The saved admission receipt then goes to the REAL campaign-runner adapter's admit as a
// reused, hash-bound admission. Controls: wrong reservation, missing completion time, changed binding, changed bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { runAdmission, QUALIFICATION_CHECKS } = require(path.join(H, 'admission-core.cjs'));
const { runIdentity } = require(path.join(H, 'identity-check.cjs'));
const { createAdapter } = require(path.join(H, 'campaign-runner.cjs'));

// The reviewed selftest fixture, verbatim (its source is compiled here; nothing in it is edited).
const SELFTEST = fs.readFileSync(path.join(__dirname, '..', '..', 'harness', 'bundle', 'selftest', 'admission.test.cjs'), 'utf8');
const FIXTURE_SRC = SELFTEST.slice(SELFTEST.indexOf('function fixture(){'), SELFTEST.indexOf('\nconst identityCalls='));
const K = { H: 'a'.repeat(64), CODE: 'b'.repeat(64), LOCK: 'c'.repeat(64), SOURCE: 'd'.repeat(40), TREE: 'e'.repeat(40), NOW: Date.parse('2026-10-27T12:00:00.000Z') };
const fixture = new Function('H', 'CODE', 'LOCK', 'SOURCE', 'TREE', 'NOW', 'QUALIFICATION_CHECKS', FIXTURE_SRC + '\nreturn fixture;')(
  K.H, K.CODE, K.LOCK, K.SOURCE, K.TREE, K.NOW, QUALIFICATION_CHECKS);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + K.SOURCE + '"};</script></html>';

function privateRoot(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'admit-reuse-')));
  fs.chmodSync(d, 0o700); fs.chownSync(d, process.getuid(), process.getgid());
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

async function admitted(t) {
  const root = privateRoot(t), run = path.join(root, 'run'), ledgers = path.join(root, 'ledgers');
  fs.mkdirSync(run, { mode: 0o700 }); fs.mkdirSync(ledgers, { mode: 0o700 });
  const f = fixture();
  f.c.identityLedger = path.join(ledgers, 'identity-ledger.json'); f.c.identityCap = 32;
  const fixtureCommand = f.io.command;
  f.io.command = async (cmd, argv, opts) => {
    if (!argv[0].endsWith('identity-check.cjs')) return fixtureCommand(cmd, argv, opts);
    const at = k => argv[argv.indexOf(k) + 1];
    // the REAL helper's runIdentity, exactly the binding admission passes; only curl is a fake transport. Its stdout is what main prints.
    const r = runIdentity({ ledger: at('--ledger'), binding: { url: at('--url'), expectedSha: at('--expect-sha'), cap: Number(at('--cap')), phase: at('--phase') } },
      (_c, a) => { fs.writeFileSync(a[a.indexOf('--output') + 1], body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) }; });
    return { status: r.exitCode, stdout: JSON.stringify(r.receipt) + '\n' };
  };
  const result = await runAdmission(f.options, f.io);
  assert.equal(result.receipt.result, 'ADMISSION PASS');
  const plan = { campaignId: f.c.campaignId, campaignLedger: f.c.campaignLedger, identityLedger: f.c.identityLedger, identityCap: f.c.identityCap,
    sourceSha: K.SOURCE, servedSha: K.SOURCE, deadlineAt: f.c.approvedDeadlineAt, runRoot: run, cleanupReserveMs: 60000 };
  const dir = path.join(run, 'admission'); fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, 'admission-receipt.json');
  const write = doc => { const bytes = Buffer.from(JSON.stringify(doc, null, 2)); fs.writeFileSync(file, bytes, { mode: 0o600 }); return sha(bytes); };
  return { f, plan, file, write, receipt: JSON.parse(JSON.stringify(result.receipt)) };
}

const reuse = (a, digest, plan = a.plan) => createAdapter(plan, '/unused-bundle', { executeR0: true, reusedAdmissionFile: a.file, reusedAdmissionSha256: digest }).admit();

test('actual admission -> saved receipt -> actual reused admit(): accepted, and the receipt is the persisted ledger record', async t => {
  const a = await admitted(t);
  const stored = JSON.parse(fs.readFileSync(a.plan.identityLedger, 'utf8')).receipts[0];
  assert.deepEqual(a.receipt.identityReceipt, stored);
  assert.equal(stored.reservation, 1);
  const admission = await reuse(a, a.write(a.receipt));
  assert.equal(admission.result, 'ADMISSION PASS');
});

test('controls: wrong reservation, missing completion time, changed binding and changed bytes all refuse', async t => {
  const a = await admitted(t);
  const cases = [
    [r => { r.identityReceipt.reservation = 2; }, /first exact served-release read/],
    [r => { delete r.identityReceipt.endedAt; }, /completion time invalid/],
    [r => { r.endedAt = 'not-a-time'; }, /completion time invalid/],
  ];
  for (const [edit, refusal] of cases) {
    const doc = JSON.parse(JSON.stringify(a.receipt)); edit(doc);
    await assert.rejects(reuse(a, a.write(doc)), refusal);
  }
  const digest = a.write(a.receipt);
  await assert.rejects(reuse(a, digest, { ...a.plan, deadlineAt: '2026-10-27T13:00:01.000Z' }), /binding differs: approvedDeadlineAt/);
  await assert.rejects(reuse(a, 'f'.repeat(64)), /bound input bytes changed/);
});
