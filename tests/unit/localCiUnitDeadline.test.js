// @vitest-environment node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');

const source = fs.readFileSync(new URL('../../scripts/run-ci.mjs', import.meta.url), 'utf8');
const commandSource = source.slice(source.indexOf('async function runCommand('), source.indexOf('\nconst ciTelemetry ='));
const fullBranch = source.indexOf("} else if (impactOutput === 'ALL' || isFullMode) {");
const callStart = source.indexOf('await runCommand(', fullBranch);
const fullUnitCall = source.slice(callStart, source.indexOf("stage.addSubTask('unit-tests'", callStart)).trim();
assert.ok(fullBranch >= 0 && callStart > fullBranch && fullUnitCall.includes("label: 'UNIT'"));
const measuredUnitMs = 2489420;

// Only the process boundary and wall clock are simulated. The command function and full-UNIT
// invocation execute from the shipped script, including AbortController/error/close handling.
function execution(call, { duration = measuredUnitMs, code = 0 } = {}) {
    let now = 0, nextId = 0, aborted = false;
    const timers = new Map(), calls = [];
    const schedule = (fn, delay) => { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; };
    const cancel = id => timers.delete(id);
    const spawn = (command, args, options) => {
        calls.push({ command, args: Array.from(args), options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        const completion = Number.isFinite(duration) ? schedule(() => child.emit('close', code), duration) : null;
        options.signal.addEventListener('abort', () => {
            aborted = true; cancel(completion);
            child.emit('error', Object.assign(new Error('process aborted'), { name: 'AbortError' }));
            child.emit('close', null);
        }, { once: true });
        return child;
    };
    const context = vm.createContext({ spawn, setTimeout: schedule, clearTimeout: cancel, AbortController,
        rootDir: '/fixture', process: { env: {} }, console: { log() {}, error() {} },
        cleanLog: line => line, throttledLog() {}, ANSI: {}, global: { __CI_TELEMETRY__: {} } });
    vm.runInContext(commandSource, context);
    const result = vm.runInContext(`(async () => { ${call} })()`, context)
        .then(() => ({ ok: true }), error => ({ ok: false, error }));
    const advance = until => {
        while (true) {
            const entry = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!entry || entry[1].at > until) break;
            timers.delete(entry[0]); now = entry[1].at; entry[1].fn();
        }
        now = until;
    };
    return { result, advance, calls, timers, get aborted() { return aborted; } };
}

test('the original ten-minute aggregate deadline aborts the observed full-unit workload', async () => {
    const originalCall = fullUnitCall.replace(', timeout: 3600000', '');
    assert.notEqual(originalCall, fullUnitCall, 'the old policy must be an actual counterfactual');
    const run = execution(originalCall);
    run.advance(measuredUnitMs);
    const outcome = await run.result;
    assert.equal(outcome.ok, false); assert.equal(run.aborted, true);
    assert.match(outcome.error.message, /Aborted due to timeout/);
    assert.equal(run.timers.size, 0);
});

test('full-unit invocation completes that workload with coverage/reporting and direct spawn intact', async () => {
    const run = execution(fullUnitCall);
    run.advance(measuredUnitMs);
    assert.deepEqual(await run.result, { ok: true }); assert.equal(run.aborted, false);
    assert.deepEqual(run.calls[0].args, ['exec', 'vitest', 'run', '--config', 'frontend/vitest.config.mjs',
        '--coverage', '--coverage.reporter=json-summary', '--reporter=./scripts/vitest-ci-reporter.mjs']);
    assert.equal(run.calls[0].command, 'pnpm'); assert.equal(run.calls[0].options.shell, false);
    assert.equal(run.timers.size, 0, 'successful completion cancels the aggregate deadline');
});

test('a stalled full-unit process is still aborted at the finite one-hour deadline', async () => {
    const run = execution(fullUnitCall, { duration: Infinity });
    run.advance(3599999); assert.equal(run.aborted, false);
    run.advance(3600000); assert.equal(run.aborted, true);
    const outcome = await run.result;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, /Aborted due to timeout/);
    assert.equal(run.timers.size, 0);
});

test('a failing full-unit child remains a failure rather than waiting for or hiding behind the deadline', async () => {
    const run = execution(fullUnitCall, { duration: 1000, code: 2 });
    run.advance(1000);
    const outcome = await run.result;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, /Exited with code 2/);
    assert.equal(run.aborted, false); assert.equal(run.timers.size, 0);
});

for (const label of ['BUILD', 'UNIT']) test(`${label} calls without the full-suite override retain the ten-minute bound`, async () => {
    const run = execution(`await runCommand('pnpm', ['fixture'], { label: '${label}' });`, { duration: 900000 });
    run.advance(599999); assert.equal(run.aborted, false);
    run.advance(600000); assert.equal(run.aborted, true);
    assert.equal((await run.result).ok, false); assert.equal(run.timers.size, 0);
});
