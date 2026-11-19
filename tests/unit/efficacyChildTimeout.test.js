import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const moduleUrl = file => JSON.stringify(pathToFileURL(path.join(root, file)).href);

// Processes that can still run. A zombie has exited and cannot write (same rule as drainOwnedPhase); where PID 1
// does not reap orphans, an exited coordinator or phase member can stay a zombie indefinitely.
const liveProcesses = () => execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n')
  .map(line => line.trim().split(/\s+/).map((field, index) => (index < 2 ? Number(field) : field)))
  .filter(([, , stat]) => !/^[ZX]/.test(stat));
const liveMembers = group => liveProcesses().filter(([, pgid]) => pgid === group);
const running = pid => liveProcesses().some(([candidate]) => candidate === pid);

// Publish whole snapshots atomically: polling readers must never observe truncation.
// The optional hook makes the write/rename boundary deterministic in the control below.
function atomicWitness(io, file, facts, beforeRename = () => {}) {
  const pending = `${file}.${process.pid}.pending`;
  try {
    io.writeFileSync(pending, JSON.stringify(facts));
    beforeRename();
    io.renameSync(pending, file);
  } finally {
    io.rmSync(pending, { force: true });
  }
}
const publishWitness = (...args) => atomicWitness(fs, ...args);

test('witness publication keeps the previous complete snapshot until atomic rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efficacy-witness-publication-'));
  const file = path.join(dir, 'witness.json');
  try {
    publishWitness(file, { done: false, phaseStartedAt: 1 });
    publishWitness(file, { done: true, phaseStartedAt: 1, phaseEndedAt: 2 }, () => {
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { done: false, phaseStartedAt: 1 });
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { done: true, phaseStartedAt: 1, phaseEndedAt: 2 });
    assert.deepEqual(fs.readdirSync(dir), ['witness.json']);
    assert.throws(() => publishWitness(file, { done: false }, () => { throw new Error('interrupted publication'); }),
      /interrupted publication/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).done, true);
    assert.deepEqual(fs.readdirSync(dir), ['witness.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Scaled stand-in for scripts/run-test-efficacy.mjs: one bounded detached phase whose leader starts a same-group
// member, both writing until killed, then drained and cleaned up with the real coordinator helpers.
const coordinatorSource = `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupOwnedCopy, drainOwnedPhase } from ${moduleUrl('scripts/run-test-efficacy.mjs')};
${atomicWitness.toString()}
const publishWitness = (...args) => atomicWitness(fs, ...args);
const witness = process.env.EFFICACY_TIMEOUT_WITNESS;
const record = facts => publishWitness(witness, { ...JSON.parse(fs.readFileSync(witness, 'utf8')), ...facts });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'speaksharp-efficacy-timeout-fixture-'));
const log = path.join(temporary, 'phase-writes.log');
publishWitness(witness, { coordinatorPid: process.pid, temporary });
const writer = \`const fs=require('node:fs');setInterval(()=>fs.appendFileSync(\${JSON.stringify(log)},Date.now()+'\\\\n'),20);\`;
const leader = \`require('node:child_process').spawn(process.execPath,['-e',\${JSON.stringify(writer)}],{stdio:'ignore'});\${writer}\`;
record({ phaseStartedAt: Date.now() });
const result = spawnSync(process.execPath, ['-e', leader], { timeout: Number(process.env.EFFICACY_TIMEOUT_PHASE_MS),
  killSignal: 'SIGKILL', detached: true, stdio: 'ignore' });
const phaseEndedAt = Date.now();
const drain = drainOwnedPhase(result);
const count = () => fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;
const writesAtDrain = count();
await new Promise(resolve => setTimeout(resolve, 300));
const writesAfterDrain = count();
cleanupOwnedCopy(temporary);
record({ group: result.pid, phaseEndedAt, drain, writesAtDrain, writesAfterDrain, done: true });
console.log(JSON.stringify({ status: 'drained' }));
`;
// The fixture test calls the same runEfficacyChild the user-harm controls test uses.
const fixtureTestSource = `import { test } from 'vitest';
import { runEfficacyChild } from ${moduleUrl('scripts/lib/efficacyChild.mjs')};
test('times out while the coordinator phase is active', async () => {
  await runEfficacyChild(new URL('./coordinator.mjs', import.meta.url).pathname, [], { cwd: process.cwd(), env: process.env });
}, Number(process.env.EFFICACY_TIMEOUT_TEST_MS));
`;
// Same pool as the unit suite (forks), so the timeout and worker teardown are the real lifecycle.
const configSource = `export default { test: { include: ['timeout.fixture.mjs'], environment: 'node', pool: 'forks',
  poolOptions: { forks: { isolate: true, maxForks: 1 } }, watch: false } };
`;

// Negative control for runEfficacyChild (tests/unit/userHarmControls.test.js). A real Vitest run times its test
// out while the coordinator's detached phase is still writing. The coordinator must survive that timeout, drain
// the whole phase group, see no write after the drain, remove its temporary copy and exit. No receipt file or
// directory is involved, because the receipt travels on stdout.
test('a Vitest test timeout mid-phase leaves the coordinator to drain its phase and clean up', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efficacy-child-timeout-'));
  const witnessFile = path.join(dir, 'witness.json');
  const testMs = 1000;
  const phaseMs = 3000;
  try {
    fs.writeFileSync(path.join(dir, 'coordinator.mjs'), coordinatorSource);
    fs.writeFileSync(path.join(dir, 'timeout.fixture.mjs'), fixtureTestSource);
    fs.writeFileSync(path.join(dir, 'vitest.config.mjs'), configSource);
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const run = await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', path.join(dir, 'vitest.config.mjs'), '--root', dir], {
      cwd: dir, timeout: 45_000, maxBuffer: 16 * 1024 * 1024,
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
    while (running(witness.coordinatorPid) && Date.now() < exitDeadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(running(witness.coordinatorPid), false, 'coordinator exits after cleanup');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
