'use strict';
// R10 run 42318728005 (Sam 1794012265.884079): the parent prepare_media_parent.py creates (root-owned 0711) must pass the EXISTING
// media-private.cjs cross-UID parent check unchanged, and the shapes the preparer refuses must also be refused by that validator.
// Offline: the reviewed adapter seam reports the root owner the hosted runner would have; every mode/type bit is the real file's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPrivateMedia } = require(path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness', 'media-private.cjs'));

const PARENT_REFUSAL = /approved private parent/;
function validate(parent) {
  const asRoot = (st) => new Proxy(st, { get: (t, k) => (k === 'uid' ? 0 : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
  const adapter = {
    getuid: () => 0, getgid: () => 0,
    fs: { ...fs, lstatSync: (p, ...r) => (p === parent ? asRoot(fs.lstatSync(p, ...r)) : fs.lstatSync(p, ...r)) },
  };
  try {
    createPrivateMedia({ sourceFile: path.join(parent, '..', 'no-such-source.wav'), expectedSha256: 'a'.repeat(64), targetUid: 65534, targetGid: 65534,
      approvedPrivateParent: parent }, adapter);
  } catch (e) { return PARENT_REFUSAL.test(e.message) ? 'refused' : 'parent-accepted'; }
  return 'parent-accepted';
}

function prepared(mode) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'media-validator-')));
  fs.chmodSync(base, 0o755);
  const parent = path.join(base, 'ss-media-cloud-test');
  if (mode === 'preparer') {
    execFileSync('python3', ['-I', '-c', 'import sys,os; sys.path.insert(0,sys.argv[1]); import prepare_media_parent as M; M.prepare(sys.argv[2], sys.argv[2], os.getuid(), sys.argv[3])',
      path.join(__dirname, '..', '..', 'scripts'), parent, base]);
  } else { fs.mkdirSync(parent); fs.chmodSync(parent, mode); }
  return parent;
}

test('the preparer-created parent (0711) passes the existing media-private validator', () => {
  const parent = prepared('preparer');
  assert.equal(fs.statSync(parent).mode & 0o777, 0o711);
  assert.equal(validate(parent), 'parent-accepted');
});

test('the shapes the preparer refuses are refused by the existing validator too', () => {
  assert.equal(validate(prepared(0o775)), 'refused');   // group/other writable
  assert.equal(validate(prepared(0o700)), 'refused');   // not traversable by 65534
});
