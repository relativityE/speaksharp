// @vitest-environment node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drainOwnedPhase } from '../../scripts/run-test-efficacy.mjs';
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

const root = fileURLToPath(new URL('../../', import.meta.url));
const reporterSource = fs.readFileSync(new URL('../../scripts/vitest-ci-reporter.mjs', import.meta.url), 'utf8');
const parserSource = fs.readFileSync(new URL('../../scripts/ci-telemetry-utils.mjs', import.meta.url), 'utf8');
const between = (text, start, end) => {
    const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, 'actual controller source boundary changed');
    return text.slice(a, b);
};

// Execute the actual stage/catch/finally/audit and reporter/parser. Only process/FS boundaries
// and successful downstream E2E are simulated; the UNIT failure must survive those green counts.
async function observeUnitExit(rejectUnit, childReport) {
    const files = new Map();
    const context = vm.createContext({
        path, Date, JSON, Set, Map, Math, Number, Error,
        process: { env: {}, argv: [], cwd: () => '/fixture', send(message) {
            context.global.__CI_TELEMETRY__.vitest = message.data;
        } },
        console: { log() {}, warn() {}, error() {} },
        ANSI: {}, formatDuration: () => '', readInvalidRcEvidence: () => null,
        rootDir: '/fixture', isInfraMode: false, isFullMode: true,
        os: { cpus: () => [{}] }, CI_CONFIG: { WORKER_SCALING_RATIO: 1, MAX_WORKERS: 1 },
        global: { __CI_TELEMETRY__: { vitest: { total: 0 }, playwright: { total: 0 } }, __CI_TIMINGS__: [] },
        __fixtureChildProcess: { execSync: () => Buffer.from('ALL') },
        fs: {
            existsSync: () => true, mkdirSync() {},
            writeFileSync(file, bytes) { files.set(file, bytes); },
            readFileSync(file) { assert.ok(files.has(file), 'fresh report must exist'); return files.get(file); },
            readdirSync: () => ['results-1.json', 'results-2.json', 'results-3.json', 'results-4.json'],
        },
        parsePlaywrightResults: () => ({ passed: 1, failed: 0, total: 1, flaky: 0 }),
    });
    vm.runInContext(reporterSource.replace(/^import .*;\s*$/gm, '')
        .replace('export default class VitestCIReporter', 'globalThis.Reporter = class VitestCIReporter'), context);
    vm.runInContext(between(parserSource, 'export function parseVitestResults(', '/**\n * Extracts SQM')
        .replace('export function', 'function'), context);
    vm.runInContext(between(source, 'function buildAuditModel(', '\nfunction readInvalidRcEvidence('), context);
    vm.runInContext(between(source, 'class Stage {', '\nasync function waitForHTTP('), context);
    vm.runInContext(between(source, 'const ciTelemetry = {', '\nasync function main()'), context);
    context.runCommand = async (_command, _args, options = {}) => {
        if (options.label !== 'UNIT') return;
        if (childReport) files.set('/fixture/test-results/unit/results.json', JSON.stringify(childReport));
        else new context.Reporter().onFinished([{ filepath: '/fixture/tests/pass.test.ts', name: 'pass.test.ts',
            type: 'suite', result: { state: 'pass' }, tasks: [{ type: 'test', name: 'assertion passes',
                result: { state: 'pass', duration: 1 }, meta: { assertionCalls: 1 } }] }],
        rejectUnit ? [new Error('controlled unhandled rejection')] : []);
        if (rejectUnit) throw new Error('[UNIT] Exited with code 1');
    };
    let stageCall = between(source, 'await runStage(3, "Test Execution", async (stage) => {', '\n        // Stage 4:');
    stageCall = stageCall.replace(/\n {8}}\s*$/, '')
        .replace("const { execSync } = await import('child_process');", 'const { execSync } = __fixtureChildProcess;');
    await vm.runInContext(`(async () => { ${stageCall} })()`, context);
    return JSON.parse(JSON.stringify(vm.runInContext('buildAuditModel(ciTelemetry)', context)));
}

test('a rejected UNIT command fails the actual stage and audit despite fresh all-pass task counts', async () => {
    assert.equal((await observeUnitExit(true)).status, 'FAILED');
});

test('successful UNIT and downstream commands still produce a passed audit', async () => {
    assert.equal((await observeUnitExit(false)).status, 'PASSED');
});

test('real nonzero Vitest child cannot be qualified by its fresh all-pass report; clean child still passes', async () => {
    for (const unhandled of [true, false]) {
        const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'unit-exit-witness-'));
        let drained = false;
        try {
            fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
            fs.writeFileSync(path.join(temporary, 'vitest.config.mjs'), 'export default {test:{include:["controlled.test.mjs"],environment:"node",pool:"forks",maxWorkers:1,minWorkers:1,fileParallelism:false}};\n');
            const actualReporter = path.join(root, 'scripts/vitest-ci-reporter.mjs');
            fs.writeFileSync(path.join(temporary, 'witness-reporter.mjs'), `import ActualReporter from ${JSON.stringify(actualReporter)};
                import fs from 'node:fs';
                export default class extends ActualReporter { onFinished(files, errors) {
                    fs.writeFileSync('runtime-errors.json', JSON.stringify((errors || []).map(error => ({name:error.name,message:error.message}))));
                    return super.onFinished(files, errors);
                } }\n`);
            const rejected = unhandled ? `Promise.reject(new Error('controlled_unhandled_unit_error'));
                await new Promise(resolve => setImmediate(resolve));` : '';
            fs.writeFileSync(path.join(temporary, 'controlled.test.mjs'), `import {test,expect} from 'vitest';
                test('one real assertion passes', async () => { ${rejected} expect(1).toBe(1); });\n`);
            const reportFile = path.join(temporary, 'official.json');
            const child = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run',
                '--config', 'vitest.config.mjs', '--coverage.enabled=false', '--retry=0', '--reporter=json',
                `--reporter=${path.join(temporary, 'witness-reporter.mjs')}`, `--outputFile=${reportFile}`],
            { cwd: temporary, detached: true, timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
                env: { PATH: process.env.PATH, HOME: temporary, TMPDIR: fs.realpathSync(os.tmpdir()), CI: 'true' } });
            const cleanup = drainOwnedPhase(child); drained = cleanup.status === 'drained' || cleanup.status === 'not-started';
            assert.equal(child.error, undefined); assert.equal(child.signal, null);
            assert.equal(child.status, unhandled ? 1 : 0, child.stderr?.toString());
            const official = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
            const bridge = JSON.parse(fs.readFileSync(path.join(temporary, 'test-results/unit/results.json'), 'utf8'));
            assert.equal(official.numPassedTests, 1); assert.equal(official.numFailedTests, 0);
            assert.equal(official.testResults[0].assertionResults[0].status, 'passed');
            assert.equal(bridge.numPassedTests, 1); assert.equal(bridge.numFailedTests, 0);
            const errors = JSON.parse(fs.readFileSync(path.join(temporary, 'runtime-errors.json'), 'utf8'));
            assert.equal(errors.length, unhandled ? 1 : 0);
            if (unhandled) assert.equal(errors[0].message, 'controlled_unhandled_unit_error');
            assert.equal((await observeUnitExit(child.status !== 0, bridge)).status, unhandled ? 'FAILED' : 'PASSED');
        } finally {
            if (drained) fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
});
