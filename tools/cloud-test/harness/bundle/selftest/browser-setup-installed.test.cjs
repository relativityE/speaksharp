'use strict';
// Installed-receipt browser mode (Sam 1793471617.605719): the reviewed baseline governs, the receipt must bind the exact native bytes and version,
// and stale, mismatched, lowered-baseline, symlinked, non-native or drifted receipts are refused. These are pure controls of the one shared
// definition; the consumers' actual wiring is qualified once the receiving pins exist, never by bypassing the approval gate.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const IB = require('../harness/installed-browser.cjs');

function fixture(t, bytes = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('synthetic native body')])) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ib-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'chrome');
  fs.writeFileSync(bin, bytes, { mode: 0o755 });
  const receipt = { schema: IB.SCHEMA, environment: 'github-hosted', minimumMajor: 156, baselinesSha256: 'b'.repeat(64), path: bin, binaryFormat: 'ELF',
    product: 'Google Chrome', version: '156.0.8078.47', observedBinarySha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    versionExecuted: true, browserLaunched: false, sourceSha: 'a'.repeat(40), runId: '1.1' };
  return { dir, bin, receipt };
}

test('a receipt binding the exact native bytes at or above the reviewed baseline yields its canonical binary', t => {
  const f = fixture(t);
  assert.equal(IB.validateInstalledReceipt(f.receipt, 156), f.bin);
});

const refusals = [
  ['a lowered or different baseline', (r) => { r.minimumMajor = 150; }, /different browser baseline/],
  ['a version below the reviewed baseline', (r) => { r.version = '155.0.1.2'; }, /below the reviewed baseline/],
  ['an unexecuted version', (r) => { r.versionExecuted = false; }, /version-executed/],
  ['another schema (existing-browser pin receipt)', (r) => { r.schema = 'speaksharp.cloud-test.existing-browser.v1'; }, /version-executed/],
  ['a non-Linux binary format', (r) => { r.binaryFormat = 'Mach-O'; }, /native Linux/],
  ['a relative path', (r) => { r.path = 'chrome'; }, /absolute/],
  ['a missing binary', (r) => { r.path = r.path + '-gone'; }, /not present/],
  ['bytes that drifted from the receipt', (r) => { r.observedBinarySha256 = 'c'.repeat(64); }, /bytes differ/],
];
for (const [name, mutate, reason] of refusals) test('refuses ' + name, t => {
  const f = fixture(t);
  mutate(f.receipt);
  assert.throws(() => IB.validateInstalledReceipt(f.receipt, 156), reason);
});

test('the receipt cannot lower the baseline: the reviewed value passed in governs, never the receipt field', t => {
  const f = fixture(t);
  f.receipt.minimumMajor = 100; f.receipt.version = '120.0.0.1';
  assert.throws(() => IB.validateInstalledReceipt(f.receipt, 156), /different browser baseline/);
  assert.throws(() => IB.validateInstalledReceipt(f.receipt, Number.NaN), /baseline missing/);
});

test('refuses a symlinked path and a launcher script, even with matching hashes', t => {
  const f = fixture(t);
  const link = path.join(f.dir, 'google-chrome');
  fs.symlinkSync(f.bin, link);
  assert.throws(() => IB.validateInstalledReceipt({ ...f.receipt, path: link }, 156), /canonical regular file/);
  const script = Buffer.from('#!/bin/sh\nexec /opt/google/chrome/chrome "$@"\n');
  const s = fixture(t, script);
  assert.throws(() => IB.validateInstalledReceipt(s.receipt, 156), /not a native ELF/);
});

test('the wrapped copy must report exactly the receipt version, at or above the baseline', () => {
  const r = { version: '156.0.8078.47' };
  assert.equal(IB.wrappedVersionMatches('Google Chrome 156.0.8078.47 \n', r, 156), true);
  assert.equal(IB.wrappedVersionMatches('Google Chrome 156.0.8078.48', r, 156), false);
  assert.equal(IB.wrappedVersionMatches('Chromium 156.0.8078.47', r, 157), false);
  assert.equal(IB.wrappedVersionMatches('not a browser', r, 156), false);
});

test('one identity: a Playwright revision, or the receipt, and null for anything malformed or self-contradictory', () => {
  assert.equal(IB.browserIdentity({ revision: 'chromium-1200' }), 'chromium-1200');
  const ok = { browserMode: 'installed-receipt', revision: null, receiptSha256: 'd'.repeat(64), installedVersion: '156.0.8078.47' };
  assert.equal(IB.browserIdentity(ok), 'installed:' + 'd'.repeat(64));
  for (const bad of [{ ...ok, revision: 'chromium-1200' }, { ...ok, receiptSha256: 'short' }, { ...ok, installedVersion: '156' }, { ...ok, browserMode: 'other' },
    { revision: 'installed:x' }, {}, null])
    assert.equal(IB.browserIdentity(bad), null, JSON.stringify(bad));
});

test('browser setup, runtime admission and qualification all derive the identity from this one module', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['harness/browser-setup.cjs', 'harness/runtime-admission.cjs', 'qualification/selftest.cjs'])
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /installed-browser\.cjs/, file);
});
