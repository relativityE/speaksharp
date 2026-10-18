// @offline. The Playwright body deliberately times out; Node asserts its
// teardown audit. All account operations use a fake adapter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
const config = resolve(root, 'tests/offline/playwright-timeout-races.config.cjs');

for (const [mode, expected] of [
  ['late', { lateContinuation: true, browserWaitCancelled: false, outcome: 'verified_zero' }],
  ['cancel', { lateContinuation: true, browserWaitCancelled: true, outcome: 'verified_zero' }],
  ['partial-exact', { lateContinuation: false, browserWaitCancelled: false, outcome: 'verified_zero' }],
  ['partial-ambiguous', { lateContinuation: false, browserWaitCancelled: false, outcome: 'unverified' }],
  ['partial-missing', { lateContinuation: false, browserWaitCancelled: false, outcome: 'unverified' }],
]) {
  test(`timeout race ${mode} has one cleanup and one truthful receipt`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwt-timeout-race-'));
    const auditPath = join(dir, 'audit.json');
    try {
      const run = spawnSync(process.execPath, [cli, 'test', '--config', config], {
        cwd: root, timeout: 15_000, encoding: 'utf8',
        env: { ...process.env, RWT_OFFLINE_AUDIT_PATH: auditPath, RWT_OFFLINE_RACE_MODE: mode },
      });
      assert.equal(run.error, undefined, String(run.error));
      assert.equal(run.status, 1, `body should time out: ${run.stdout}\n${run.stderr}`);
      const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
      assert.equal(audit.bodyStatus, 'timedOut');
      assert.equal(audit.contextClosed, true);
      assert.equal(audit.mintedEmail.startsWith('rwt-journey-'), true);
      assert.equal(audit.capturedUid === '', mode.startsWith('partial-'));
      assert.equal(audit.lateContinuation, expected.lateContinuation);
      assert.equal(audit.browserWaitCancelled, expected.browserWaitCancelled);
      assert.equal(audit.outcome, expected.outcome);
      assert.equal(audit.adapterCalls, 1, 'late body and teardown share one cleanup');
      assert.equal(audit.receiptWrites, 1, 'late body and teardown share one receipt');
      assert.equal(audit.finalizerCalls, mode === 'late' || mode === 'cancel' ? 2 : 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('negative control: without single-flight a late continuation duplicates cleanup and receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rwt-timeout-race-'));
  const auditPath = join(dir, 'audit.json');
  try {
    const run = spawnSync(process.execPath, [cli, 'test', '--config', config], {
      cwd: root, timeout: 15_000, encoding: 'utf8',
      env: { ...process.env, RWT_OFFLINE_AUDIT_PATH: auditPath, RWT_OFFLINE_RACE_MODE: 'late', RWT_OFFLINE_DISABLE_SINGLE_FLIGHT: '1' },
    });
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(run.status, 1, 'body deliberately times out');
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.lateContinuation, true);
    assert.equal(audit.adapterCalls, 2);
    assert.equal(audit.receiptWrites, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
