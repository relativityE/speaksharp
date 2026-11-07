'use strict';
// R10 run 42386714252 (Sam 1794066358): when A7's identity helper returns no JSON receipt, admission keeps only its exit status and a
// closed, content-free stderr class. Real helper output is classified exactly; secret/URL-bearing text never survives.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const H = path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness');
const { identityHelperDiagnostic } = require(path.join(H, 'admission-core.cjs'));

const SECRET = ['eyJhbGciOiJIUzI1NiJ9', 'c2VjcmV0', 'c2ln'].join('.');
const RUNNER_HOME = ['', 'home', 'runner', ''].join('/');

test('the real helper refusal on a non-private ledger directory classifies as private-ownership, content-free', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-diag-')));
  const ledgers = path.join(base, 'ledgers'); fs.mkdirSync(ledgers, { mode: 0o755 }); fs.chmodSync(ledgers, 0o755);
  const r = spawnSync(process.execPath, [path.join(H, 'identity-check.cjs'), '--authorize-identity-read', 'true', '--url', 'https://example.invalid/',
    '--expect-sha', 'a'.repeat(40), '--ledger', path.join(ledgers, 'identity-ledger.json'), '--cap', '1', '--phase', 'admission'], { encoding: 'utf8' });
  assert.equal(r.stdout, '');
  const d = identityHelperDiagnostic(r);
  assert.deepEqual(d, { exitCode: 2, timedOut: false, stderrClass: 'private-ownership', contentFree: true });
  assert.ok(!JSON.stringify(d).includes(base));
});

test('every closed class, and unknown or empty stderr', () => {
  const cases = [
    ['BLOCKED_SETUP identity: private file required (owned regular single-link, mode 0600): ' + RUNNER_HOME + 'x', 'private-ownership'],
    ["BLOCKED_SETUP identity: EEXIST: file already exists, open '" + RUNNER_HOME + "ledger.json.lock'", 'ledger-lock'],
    ['BLOCKED_SETUP identity: identity ledger corrupt or campaign binding changed', 'ledger-state'],
    ['BLOCKED_SETUP identity: NOT AUTHORIZED: add --authorize-identity-read true', 'not-authorized'],
    ['BLOCKED_SETUP identity: identity binding requires canonical HTTPS root URL', 'binding'],
    ["BLOCKED_SETUP identity: EACCES: permission denied, open '" + RUNNER_HOME + "x'", 'filesystem'],
    ['segfault at https://example.invalid/?token=' + SECRET, 'other'],
    ['', 'none'],
  ];
  for (const [stderr, cls] of cases) {
    const d = identityHelperDiagnostic({ status: 2, stderr });
    assert.equal(d.stderrClass, cls, stderr.slice(0, 40));
    const text = JSON.stringify(d);
    for (const forbidden of [SECRET, 'https:', RUNNER_HOME.slice(0, -1), 'token']) assert.ok(!text.includes(forbidden), forbidden);
  }
});

test('missing status, signal kill and timeout are represented without text', () => {
  assert.deepEqual(identityHelperDiagnostic({ status: null, signal: 'SIGKILL', reason: 'timeout', stderr: SECRET }),
    { exitCode: null, timedOut: true, stderrClass: 'other', contentFree: true });
  assert.deepEqual(identityHelperDiagnostic(undefined), { exitCode: null, timedOut: false, stderrClass: 'none', contentFree: true });
});

test('admission still refuses with the same message and leaves traffic UNKNOWN (source pin)', () => {
  const src = fs.readFileSync(path.join(H, 'admission-core.cjs'), 'utf8');
  assert.match(src, /catch\{receipt\.identityHelperDiagnostic=identityHelperDiagnostic\(r\);await save\(\);throw new Error\('identity receipt unavailable; outcome ambiguous; no automatic retry'\);\}/);
  assert.match(src, /receipt\.identityDispatch='ATTEMPTED_OR_AMBIGUOUS';receipt\.productionTrafficSent='UNKNOWN_PENDING_IDENTITY_RECEIPT'/);
});
