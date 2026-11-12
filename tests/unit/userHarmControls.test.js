import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_HARM_CONTROLS, mutateBytes, runTestEfficacy } from '../../scripts/run-test-efficacy.mjs';
import { runEfficacyChild } from '../../scripts/lib/efficacyChild.mjs';

const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('named user-harm controls bind distinct real source edits and unique assertion locations', () => {
  assert.equal(new Set(USER_HARM_CONTROLS.map(control => control.id)).size, 3);
  for (const control of USER_HARM_CONTROLS) {
    const source = fs.readFileSync(path.join(root, control.sourceFile));
    const testSource = fs.readFileSync(path.join(root, control.testFile), 'utf8');
    assert.equal(control.mutants.length, 1);
    assert.equal(control.control.length, 1);
    const neutral = mutateBytes(source, control.control[0].anchor, control.control[0].replacement);
    const fault = control.mutants[0];
    const mutant = mutateBytes(source, fault.anchor, fault.replacement);
    assert.notDeepEqual(neutral, mutant);
    assert.equal(testSource.split(fault.assertionAnchor).length, 2,
      `${control.id}: the designated assertion location must exist exactly once`);
  }
  assert.throws(() => runTestEfficacy({ userHarmControls: true, executionOnly: true }), /semantic mutation phases/);
});

// Ordinary hosted unit CI exercises real product tests. A local registration check does not qualify
// a missing runtime or substitute a synthetic PASS for baseline → semantic fault → restoration.
if (process.env.GITHUB_ACTIONS === 'true' || process.env.TEST_USER_HARM_REAL_RUNTIME === '1') {
  test('INSTALLED Vitest: all three named user-harm controls pass, fail their intended assertion, then pass restored', { timeout: 240_000 }, async () => {
    // runTestEfficacy blocks on synchronous child runs for minutes. Run its CLI in its own Node process so this
    // worker's event loop stays free; a multi-minute block makes Vitest's worker RPC time out and fail the shard.
    // runEfficacyChild never kills the coordinator, so a test timeout still leaves it to drain and clean up
    // (proved by tests/unit/efficacyChildTimeout.test.js).
    const receipt = await runEfficacyChild(path.join(root, 'scripts/run-test-efficacy.mjs'), ['--user-harm-controls'],
      { cwd: root, env: { ...process.env, TEST_EFFICACY_BASE: '' } });
    assert.equal(receipt.status, 'executed');
    assert.deepEqual(receipt.contracts.map(control => control.id), USER_HARM_CONTROLS.map(control => control.id));
    for (const control of receipt.contracts) {
      assert.equal(control.baseline.report.success, true);
      assert.equal(control.control.report.success, true);
      assert.equal(control.mutants.length, 1);
      assert.equal(control.mutants[0].report.success, false);
      assert.equal(control.restored.report.success, true);
      assert.equal(control.baseline.inputSha256, control.restored.inputSha256);
    }
  });
}
