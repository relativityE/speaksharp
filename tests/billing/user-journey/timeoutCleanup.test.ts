// Sam (17 Nov, after runs 44080723593 / 44098470690): prove offline that a timed-out billing journey still gets exact-owner teardown and the
// independent residue check, in a separate bounded window, and distinguish that from a killed worker. Real Playwright runs the synthetic
// specs in ./timeout-cleanup (no browser page, no network, no Stripe; 2 s test timeout); this test reads the marks each one leaves.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';

function proof(name: string): { marks: string[]; status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'billing-timeout-proof-'));
  const marks = join(dir, 'marks.txt');
  try {
    const r = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/billing/user-journey/timeout-cleanup/playwright.proof.config.ts', `proof-${name}`],
      { env: { ...process.env, PROOF_MARKS: marks, CI: '' }, encoding: 'utf8', timeout: 60_000 });
    let text = '';
    try { text = readFileSync(marks, 'utf8'); } catch { text = ''; }
    return { marks: text.trim().split('\n').filter(Boolean), status: r.status, output: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('CONTROL: cleanup in the test body finally never runs when a step hangs past the test timeout', () => {
  const r = proof('control');
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.marks, ['journey:start'], 'no owner teardown, no residue check');
}, 90_000);

test('FIX: fixture teardown runs after the timeout, in its own window, on exactly the registered owner, and checks residue', () => {
  const r = proof('fixture');
  assert.notEqual(r.status, 0, 'the timed-out test still fails');
  assert.deepEqual(r.marks, ['journey:start', 'teardown:start status=timedOut', 'teardown:owner synthetic-owner-1', 'residue:checked']);
}, 90_000);

test('BOUNDED: a teardown that hangs is cut off at its own window, so cleanup can never hang the job', () => {
  const r = proof('bounded');
  assert.deepEqual(r.marks, ['journey:start', 'teardown:start']);
  assert.match(r.output, /Fixture "owned" timeout of 1000ms exceeded during teardown/);
}, 90_000);

test('KILLED WORKER: no in-process hook runs; only an out-of-process step (the workflow) can clean up', () => {
  const r = proof('killed');
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.marks, ['journey:start']);
  // The out-of-process backstop exists: the Stripe residue check and the stack teardown run on always(), outside the test process.
  const wf = readFileSync('.github/workflows/billing-local-stack-journey.yml', 'utf8');
  assert.match(wf, /id: stripe_residue\n\s+#[^\n]*\n(\s+#[^\n]*\n)*\s+if: always\(\)/);
  assert.match(wf, /- name: Tear down the local stack and listeners\n\s+id: stack_stop\n(\s+#[^\n]*\n)*\s+if: always\(\)/);
}, 90_000);

test('the billing journey uses the proven pattern: teardown, receipt and verdict in a bounded fixture teardown, none in the test body', () => {
  const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');
  const fixture = spec.slice(spec.indexOf('const journeyCase = test.extend'), spec.indexOf('function journeyTest('));
  assert.match(fixture, /await use\(hold\);[\s\S]*await run\.cleanup\(\)[\s\S]*info\.attach\('billing-user-journey\.json'[\s\S]*\{ timeout: CLEANUP_WINDOW_MS \}\]/);
  assert.match(fixture, /info\.status === 'timedOut'/);
  const body = spec.slice(spec.indexOf('function journeyTest('), spec.indexOf('// The three lifecycle branches first'));
  assert.doesNotMatch(body, /finally|cleanup\(|attach\(/, 'nothing that must run after a timeout lives in the test body');
  assert.match(spec, /const CLEANUP_WINDOW_MS = \d+_000;/);
});
