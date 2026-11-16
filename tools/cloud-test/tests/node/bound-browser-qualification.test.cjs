'use strict';
// R10 A6 : qualification checks the bound browser copy the wrapper actually launches, never Playwright's own download.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const { boundBrowserProblem, WRAPPER_TARGET } = require(path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness', 'launch-boundary.cjs'));

const bytes = Buffer.from('bound-chrome-bytes');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const io = (present = true, content = bytes) => ({ exists: (p) => present && p === WRAPPER_TARGET, read: (p) => { assert.strictEqual(p, WRAPPER_TARGET); return content; } });
const info = (over = {}) => ({ copiedExecutable: WRAPPER_TARGET, chromeSha256: sha, ...over });

test('the wrapper target is fixed to the copy chrome-wrapper.sh execs', () => {
  assert.strictEqual(WRAPPER_TARGET, '/var/tmp/ss-harness/chrome-linux/chrome');
});

test('an intact bound copy with the discovered digest qualifies', () => {
  assert.strictEqual(boundBrowserProblem(info(), io()), null);
});

test('a missing copy refuses', () => {
  assert.strictEqual(boundBrowserProblem(info(), io(false)), 'bound browser copy missing');
});

test('a tampered copy refuses', () => {
  assert.strictEqual(boundBrowserProblem(info(), io(true, Buffer.from('tampered'))), 'bound browser copy differs from discovery');
});

test('a substituted path refuses even when that other file would hash correctly', () => {
  for (const p of ['/opt/google/chrome/chrome', '/tmp/chrome', '/var/tmp/ss-harness/chrome-linux/../chrome-linux/chrome', null]) {
    assert.strictEqual(boundBrowserProblem(info({ copiedExecutable: p }), io()), 'bound browser path is not the wrapper target', String(p));
  }
});

test('a missing or malformed discovery digest or identity refuses', () => {
  assert.strictEqual(boundBrowserProblem(info({ chromeSha256: undefined }), io()), 'bound browser digest missing');
  assert.strictEqual(boundBrowserProblem(info({ chromeSha256: 'A'.repeat(64) }), io()), 'bound browser digest missing');
  assert.strictEqual(boundBrowserProblem(null, io()), 'browser identity missing');
});
