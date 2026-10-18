// Offline Playwright fixture: this test deliberately times out. The outer Node test
// asserts the audit file, so this fixture must never enter the regular live suite.
const { test } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');

test.afterEach(async ({}, testInfo) => {
  // Playwright gives teardown a separate budget. Keep enough of it for the
  // account cleanup and receipt even when the test body's clock has expired.
  testInfo.setTimeout(1_000);
  // Negative control: a teardown that awaits a stuck diagnostic before it
  // reaches cleanup still loses the whole shared afterEach budget.
  if (process.env.RWT_OFFLINE_BLOCK_BEFORE_CLEANUP === '1') await new Promise(() => {});
  const audit = { bodyStatus: testInfo.status, diagnosticFailed: false, cleanup: 'not_attempted', receipt: 'not_written' };
  try {
    throw new Error('simulated diagnostic failure before cleanup');
  } catch {
    audit.diagnosticFailed = true;
  }
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (process.env.RWT_OFFLINE_CLEANUP_FAIL === '1') throw new Error('simulated zero-residue readback failure');
    audit.cleanup = 'verified_zero';
  } catch {
    audit.cleanup = 'unverified';
  } finally {
    audit.receipt = audit.cleanup === 'verified_zero' ? 'PASS' : 'FAIL';
    await writeFile(process.env.RWT_OFFLINE_AUDIT_PATH, JSON.stringify(audit), 'utf8');
  }
});

test('a timed-out journey still runs bounded cleanup and publishes a verdict', async () => {
  await new Promise(() => {});
});
