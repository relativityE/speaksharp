import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = path.join(root, 'tests/fixtures/efficacy/child-timeout');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
// Members of the group that can still run. A zombie has exited and cannot write (same rule as drainOwnedPhase).
const liveMembers = group => execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n')
  .map(line => line.trim().split(/\s+/)).filter(([, pgid, stat]) => Number(pgid) === group && !/^[ZX]/.test(stat));

// Negative control for runEfficacyChild (tests/unit/userHarmControls.test.js). A real Vitest run, on the
// unit suite's forks pool, times its test out while the coordinator's detached phase is still writing.
// The coordinator must survive that timeout, drain the whole phase group, see no write after the drain
// and remove its temporary copy. No receipt file or directory is involved, because the receipt is stdout.
test('a Vitest test timeout mid-phase leaves the coordinator to drain its phase and clean up', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efficacy-child-timeout-'));
  const witnessFile = path.join(dir, 'witness.json');
  const testMs = 1000;
  const phaseMs = 3000;
  try {
    const run = await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', path.join(fixture, 'vitest.config.mjs')], {
      cwd: root, timeout: 45_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, EFFICACY_TIMEOUT_WITNESS: witnessFile, EFFICACY_TIMEOUT_TEST_MS: String(testMs),
        EFFICACY_TIMEOUT_PHASE_MS: String(phaseMs) },
    }).then(() => assert.fail('the fixture test must time out'), error => error);
    assert.equal(run.code, 1);
    assert.match(`${run.stdout}${run.stderr}`, new RegExp(`Test timed out in ${testMs}ms`));

    let witness;
    const deadline = Date.now() + 20_000;
    do {
      witness = JSON.parse(fs.readFileSync(witnessFile, 'utf8'));
      if (witness.done) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(witness.done, true, 'the coordinator must survive the test timeout and finish its own cleanup');

    // The phase ran its full bounded time, so the 1s test timeout fired while it was active.
    assert.ok(witness.phaseEndedAt - witness.phaseStartedAt >= phaseMs - 100);
    assert.equal(witness.drain.status, 'drained');
    assert.equal(witness.drain.signalled, true, 'a same-group member outlived its leader and had to be drained');
    assert.ok(witness.writesAtDrain > 0);
    assert.equal(witness.writesAfterDrain, witness.writesAtDrain, 'no phase write after the drain');
    assert.equal(fs.existsSync(witness.temporary), false, 'temporary copy removed');
    assert.deepEqual(liveMembers(witness.group), [], 'no phase process survives');
    const exitDeadline = Date.now() + 5000;
    while (alive(witness.coordinatorPid) && Date.now() < exitDeadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(witness.coordinatorPid), false, 'coordinator exits after cleanup');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
