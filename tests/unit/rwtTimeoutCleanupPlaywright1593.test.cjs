// @offline. Runs the real Playwright timeout/afterEach scheduler without a
// browser, network, service key, run-owned account, or production cleanup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const cli = resolve(root, 'node_modules/@playwright/test/cli.js');
const config = resolve(root, 'tests/offline/playwright-timeout.config.cjs');

for (const [name, failCleanup, expected] of [
  ['verified teardown', false, 'PASS'],
  ['unverified teardown', true, 'FAIL'],
]) {
  test(`Playwright body timeout still writes ${name} cleanup receipt`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwt-timeout-offline-'));
    const auditPath = join(dir, 'audit.json');
    try {
      const run = spawnSync(process.execPath, [cli, 'test', '--config', config], {
        cwd: root,
        timeout: 15_000,
        encoding: 'utf8',
        env: {
          ...process.env,
          RWT_OFFLINE_AUDIT_PATH: auditPath,
          RWT_OFFLINE_CLEANUP_FAIL: failCleanup ? '1' : '0',
        },
      });
      assert.equal(run.error, undefined, String(run.error));
      assert.equal(run.status, 1, `the deliberately timed-out body must fail: ${run.stdout}\n${run.stderr}`);
      const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
      assert.deepEqual(audit, {
        bodyStatus: 'timedOut',
        diagnosticFailed: true,
        cleanup: failCleanup ? 'unverified' : 'verified_zero',
        receipt: expected,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a hung diagnostic before cleanup consumes teardown and leaves no proof', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rwt-timeout-offline-'));
  const auditPath = join(dir, 'audit.json');
  try {
    const run = spawnSync(process.execPath, [cli, 'test', '--config', config], {
      cwd: root,
      timeout: 15_000,
      encoding: 'utf8',
      env: { ...process.env, RWT_OFFLINE_AUDIT_PATH: auditPath, RWT_OFFLINE_BLOCK_BEFORE_CLEANUP: '1' },
    });
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(run.status, 1, `the timed-out body and teardown must fail: ${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout + run.stderr, /afterEach hook timeout|Test timeout of 1000ms exceeded/i);
    assert.equal(existsSync(auditPath), false, 'cleanup and its receipt never ran after the stuck diagnostic');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
