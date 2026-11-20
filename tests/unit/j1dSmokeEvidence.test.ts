// @vitest-environment node
/**
 * J1.d smoke execution evidence, smoke side: the raw SDK replay of the single smoke run, the checked teardown
 * proof bound to the same commit/run/attempt, and the producer reporter driven by the ACTUAL Playwright SDK in a synthetic
 * fixture repository. The gate wiring (ci.yml, the shared registries) is not here.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    SMOKE_TEARDOWN_SCHEMA, SMOKE_SPECS, smokeAffected, sha256, buildTeardownProof, replaySmokeBlob, smokeBinding, smokeProjectFor, teardownProofVerdict,
} from '../../scripts/j1d-smoke/smokeEvidence.mjs';
import { teardownChecks, writeTeardownProof } from '../../scripts/j1d-smoke/teardown-proof.mjs';
import { collectSmokeExecution, validateSmokeExecution } from '../../scripts/j1d-smoke/ciEvidence.mjs';
import { executionContext } from '../../scripts/lib/testExecutionEvidence.mjs';
import { readBlobReport } from '../../scripts/lib/playwrightExecutionEvidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMIT = 'a'.repeat(40);
const ctx = { repositoryRoot: '/fixture', commit: COMMIT };
type Rec = { method: string; params?: Record<string, unknown> };
function records(): Rec[] {
    return [
        { method: 'onBlobReportMetadata', params: { version: 2, userAgent: 'Playwright/1.57.0 (synthetic)' } },
        { method: 'onConfigure', params: { config: { version: '1.57.0', rootDir: '/fixture/tests/smoke', metadata: { ci: { commitHash: COMMIT } } } } },
        { method: 'onProject', params: { project: { name: 'j1d-smoke', suites: [{ entries: [{ testId: 't1', title: 'smoke body', repeatEachIndex: 0, location: { file: 'j1d.smoke.spec.ts' } }] }] } } },
        { method: 'onBegin' },
        { method: 'onTestBegin', params: { testId: 't1', result: { id: 'r1', retry: 0 } } },
        { method: 'onTestEnd', params: { test: { testId: 't1', expectedStatus: 'passed' }, result: { id: 'r1', status: 'passed', errors: [] } } },
        { method: 'onEnd', params: { result: { status: 'passed' } } },
    ];
}
const replay = (events: Rec[]) => replaySmokeBlob(events.map((e) => JSON.stringify(e)).join('\n'), ctx);
const edit = (i: number, change: (r: Rec) => void) => { const r = records(); change(r[i]); return r; };

describe('replaySmokeBlob: only one passed, unsharded smoke run of tests/smoke files earns credit', () => {
    it('a complete passed run replays to its collected tests', () => {
        expect(replay(records())).toEqual([{ id: 't1', file: 'tests/smoke/j1d.smoke.spec.ts', title: 'smoke body' }]);
    });
    it('NEGATIVE: failed, skipped, retried, errored, incomplete, sharded, other project, other commit, other scope or empty never replay', () => {
        const cases: Array<[string, Rec[], RegExp]> = [
            ['failed', edit(5, (r) => { (r.params as { result: { status: string } }).result.status = 'failed'; }), /Failed\/skipped/],
            ['skipped', edit(5, (r) => { (r.params as { test: { expectedStatus: string } }).test.expectedStatus = 'skipped'; }), /Failed\/skipped/],
            ['retried', edit(4, (r) => { (r.params as { result: { retry: number } }).result.retry = 1; }), /retried/],
            ['global error', [...records().slice(0, 6), { method: 'onError', params: {} }, records()[6]], /error or incomplete/],
            ['run not passed', edit(6, (r) => { (r.params as { result: { status: string } }).result.status = 'failed'; }), /error or incomplete/],
            ['never ended', records().filter((r) => r.method !== 'onTestEnd'), /Incomplete/],
            ['sharded', edit(0, (r) => { (r.params as Record<string, unknown>).shard = { current: 1, total: 4 }; }), /never sharded/],
            ['other project', edit(2, (r) => { (r.params as { project: { name: string } }).project.name = 'full-suite'; }), /Wrong Playwright project/],
            ['other commit', edit(1, (r) => { (r.params as { config: { metadata: { ci: { commitHash: string } } } }).config.metadata.ci.commitHash = 'b'.repeat(40); }), /Wrong blob source commit/],
            ['e2e file', edit(1, (r) => { (r.params as { config: { rootDir: string } }).config.rootDir = '/fixture/tests/e2e'; }), /outside the smoke scope/],
            ['other runtime', edit(0, (r) => { (r.params as { userAgent: string }).userAgent = 'Playwright/1.56.0 (x)'; }), /runtime identity/],
            ['nothing collected', edit(2, (r) => { (r.params as { project: { suites: unknown[] } }).project.suites = [{ entries: [] }]; }).filter((r) => !['onTestBegin', 'onTestEnd'].includes(r.method)), /No smoke test/],
        ];
        for (const [name, events, error] of cases) {
            let message = 'replayed';
            try { replay(events); } catch (e) { message = (e as Error).message; }
            expect({ name, refused: error.test(message) }).toEqual({ name, refused: true });
        }
    });
});

describe('teardown proof: CHECKED, bound to the same commit/run/attempt, never a bare destroyed:true', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '2' };
    const binding = smokeBinding(env, COMMIT);
    const identity = { project: smokeProjectFor(binding), containers: ['c1', 'c2'], volumes: ['v1'], networks: ['n1'] };
    const identityText = JSON.stringify(identity);
    const allAbsent = [...identity.containers.map((id) => ({ kind: 'container', id, absent: true })), { kind: 'volume', id: 'v1', absent: true }, { kind: 'network', id: 'n1', absent: true }];
    const none = { containers: 0, volumes: 0, networks: 0 };
    const proof = (over: Partial<Parameters<typeof buildTeardownProof>[0]> = {}) => buildTeardownProof({ binding, identity, identityText, checks: allAbsent, remaining: none, stopExit: 0, ...over });
    const expected = { ...binding, identitySha256: proof().identitySha256 };

    it('a checked stop with every recorded resource absent and empty selectors is the stack destroyed', () => {
        expect(binding).toEqual({ source: 'github-actions', commit: COMMIT, runId: '9001', runAttempt: '2' });
        expect(identity.project).toBe('j1d-smoke-9001-2');
        expect(proof()).toMatchObject({ schema: SMOKE_TEARDOWN_SCHEMA, destroyed: true, left: 0, checked: { absent: 4, total: 4 } });
        expect(teardownProofVerdict(proof(), expected)).toEqual({ status: 'PASS', reason: 'stack_destroyed' });
    });

    it('NEGATIVE: a plain destroyed:true, another head/run/attempt/stack/identity, a failed stop, or anything left is refused', () => {
        const cases: Array<[string, unknown, string]> = [
            ['plain', { destroyed: true }, 'teardown_unchecked'],
            ['other commit', { ...proof(), binding: { ...binding, commit: 'b'.repeat(40) } }, 'teardown_other_commit'],
            ['other attempt', { ...proof(), binding: { ...binding, runAttempt: '3' } }, 'teardown_other_run'],
            ['other run', { ...proof(), binding: { ...binding, runId: '9002' } }, 'teardown_other_run'],
            ['local proof', { ...proof(), binding: { ...binding, source: 'local' } }, 'teardown_other_run'],
            ['other stack', { ...proof(), project: 'j1d-smoke-9001-1' }, 'teardown_other_stack'],
            ['other identity', { ...proof(), identitySha256: '0'.repeat(64) }, 'teardown_identity_differs'],
            ['stop failed', proof({ stopExit: 1 }), 'teardown_stop_failed'],
            ['one still there', proof({ checks: allAbsent.map((c, i) => (i === 0 ? { ...c, absent: false } : c)) }), 'teardown_left_resources'],
            ['selector not empty', proof({ remaining: { ...none, volumes: 1 } }), 'teardown_left_resources'],
            ['nothing recorded', proof({ identity: { ...identity, containers: [], volumes: [], networks: [] }, checks: [] }), 'teardown_nothing_recorded'],
            ['checks missing', proof({ checks: allAbsent.slice(1) }), 'teardown_left_resources'],
        ];
        for (const [name, value, reason] of cases) expect({ name, reason: teardownProofVerdict(value as never, expected).reason }).toEqual({ name, reason });
    });

    it('teardownChecks reads Docker\'s own not-found answers; any other answer, or an unreadable selector, is not absent', () => {
        const answers: Record<string, { status: number; output: string }> = {
            'container inspect c1': { status: 1, output: '[]\nError response from daemon: No such container: c1' },
            'container inspect c2': { status: 0, output: '[{"Id":"c2"}]' },
            'volume inspect v1': { status: 1, output: '[]\nError response from daemon: get v1: no such volume' },
            'network inspect n1': { status: 1, output: '[]\nError response from daemon: network n1 not found' },
        };
        const docker = (args: string[]) => {
            const key = args.join(' ');
            if (answers[key]) return answers[key];
            if (args[0] === 'volume' && args[1] === 'ls') return { status: 1, output: 'Cannot connect to the Docker daemon' };
            return { status: 0, output: '' };
        };
        const { checks, remaining } = teardownChecks(identity, docker);
        expect(checks).toEqual([{ kind: 'container', id: 'c1', absent: true }, { kind: 'container', id: 'c2', absent: false },
            { kind: 'volume', id: 'v1', absent: true }, { kind: 'network', id: 'n1', absent: true }]);
        expect(remaining).toEqual({ containers: 0, volumes: Number.POSITIVE_INFINITY, networks: 0 });
        expect(teardownProofVerdict(proof({ checks, remaining }), expected)).toMatchObject({ status: 'FAIL' });
    });

    it('writeTeardownProof writes destroyed.json bound to the run and the exact identity file it read', () => {
        const state = fs.mkdtempSync(path.join(os.tmpdir(), 'j1d-teardown-'));
        try {
            fs.writeFileSync(path.join(state, 'identity.json'), identityText);
            const absentDocker = (args: string[]) => (args[1] === 'inspect' ? { status: 1, output: 'Error: No such object' } : { status: 0, output: '' });
            const written = writeTeardownProof(state, 0, { env, docker: absentDocker, commit: COMMIT });
            const onDisk = JSON.parse(fs.readFileSync(path.join(state, 'destroyed.json'), 'utf8'));
            expect(onDisk).toEqual(written);
            expect(teardownProofVerdict(onDisk, expected)).toEqual({ status: 'PASS', reason: 'stack_destroyed' });
            // The same stack after a stop that failed is never destroyed.
            expect(teardownProofVerdict(writeTeardownProof(state, 1, { env, docker: absentDocker, commit: COMMIT }), expected)).toMatchObject({ status: 'FAIL', reason: 'teardown_stop_failed' });
        } finally { fs.rmSync(state, { recursive: true, force: true }); }
    });

    it('a binding outside Actions is local, and Actions requires numeric run id and attempt', () => {
        expect(smokeBinding({}, COMMIT)).toEqual({ source: 'local', commit: COMMIT, runId: 'local', runAttempt: 'local' });
        expect(() => smokeBinding({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'x', GITHUB_RUN_ATTEMPT: '1' }, COMMIT)).toThrow(/run id and attempt/);
        expect(() => smokeBinding({}, 'abc')).toThrow(/exact commit/);
    });
});

// The ACTUAL Playwright SDK, as scripts/lib/playwrightExecutionEvidence.mjs's own test does: a synthetic no-browser smoke spec in a
// throwaway git repository, run with the blob reporter and the smoke producer. Runs in CI or with TEST_EFFICACY_REAL_RUNTIME=1.
function smokeFixture() {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'j1d-smoke-producer-')));
    const write = (file: string, bytes: string | Buffer) => { fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.writeFileSync(path.join(directory, file), bytes); };
    for (const file of ['scripts/efficacy-playwright-reporter.mjs', 'scripts/efficacy-reporter.mjs', 'scripts/lib/playwrightExecutionEvidence.mjs',
        'scripts/lib/testExecutionEvidence.mjs', 'scripts/lib/nativeTestExecutionEvidence.mjs', 'scripts/lib/pythonTestExecutionEvidence.mjs',
        'scripts/lib/python-unittest-reporter.py', 'scripts/lib/helperExecutionEvidence.mjs', 'scripts/lib/sourceContractEvidence.mjs',
        'scripts/lib/softwareQualityEvidenceQualification.mjs', 'scripts/coverage-thresholds.mjs',
        'scripts/j1d-smoke/smokeEvidence.mjs', 'scripts/j1d-smoke/ciEvidence.mjs', 'scripts/j1d-smoke/smoke-playwright-reporter.mjs']) {
        if (fs.existsSync(path.join(root, file))) write(file, fs.readFileSync(path.join(root, file)));
    }
    write('package.json', '{"private":true}');
    write('pnpm-lock.yaml', fs.readFileSync(path.join(root, 'pnpm-lock.yaml')));
    write('.gitignore', 'node_modules\nblob-report/\nartifacts/\ntest-results/\n.fixture-home/\n.fixture-temp/\n');
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(directory, '.fixture-home')); fs.mkdirSync(path.join(directory, '.fixture-temp'));
    write('playwright.config.cjs', "module.exports={testDir:'./tests/smoke',testMatch:/\\.smoke\\.spec\\.ts$/,retries:0,workers:1,projects:[{name:'j1d-smoke'}]};\n");
    const git = (args: string[]) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const commit = () => { git(['add', '.']); git(['-c', 'user.name=Smoke fixture', '-c', 'user.email=smoke@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']); return git(['rev-parse', 'HEAD']); };
    git(['init']);
    const body = (ok: boolean) => `import { test, expect } from '@playwright/test';\ntest('smoke arithmetic body', () => { expect(2 + 3).toBe(${ok ? 5 : 6}); });\n`;
    SMOKE_SPECS.forEach(file => write(file, body(true)));
    commit();
    const env = (job = 'j1d-smoke') => ({ PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), HOME: path.join(directory, '.fixture-home'),
        TMPDIR: path.join(directory, '.fixture-temp'), LANG: 'C.UTF-8', TZ: 'UTC', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_JOB: job,
        GITHUB_RUN_ID: '9001', GITHUB_RUN_ATTEMPT: '2', J1D_SMOKE_IDENTITY_SHA256: 'a'.repeat(64), GITHUB_SHA: git(['rev-parse', 'HEAD']) });
    const cli = path.join(path.dirname(fs.realpathSync(path.join(root, 'node_modules/playwright/package.json'))), 'cli.js');
    const run = (job?: string) => {
        for (const child of ['blob-report', 'test-results']) fs.rmSync(path.join(directory, child), { recursive: true, force: true });
        return spawnSync(process.execPath, [cli, 'test', '--config=playwright.config.cjs', '--workers=1',
            '--reporter=blob,./scripts/j1d-smoke/smoke-playwright-reporter.mjs,line'], { cwd: directory, env: env(job), encoding: 'utf8', timeout: 60_000, maxBuffer: 4 << 20 });
    };
    const receipts = () => { const d = path.join(directory, 'test-results/j1d-smoke'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
    return { directory, write, body, commit, run, receipts, git, env, clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

const REAL = process.env.GITHUB_ACTIONS === 'true' || process.env.TEST_EFFICACY_REAL_RUNTIME === '1';
describe.runIf(REAL)('the smoke producer under the ACTUAL Playwright SDK', () => {
    it('a passing smoke run writes a receipt bound to its job, run and attempt whose raw blob replays to the same collection', async () => {
        const f = smokeFixture();
        try {
            const result = f.run();
            expect({ status: result.status, output: result.status === 0 ? '' : `${result.stdout}\n${result.stderr}` }).toEqual({ status: 0, output: '' });
            const [name] = f.receipts();
            expect(name).toMatch(/^smoke-execution-9001-2-[a-f0-9-]{36}\.json$/);
            const receipt = JSON.parse(fs.readFileSync(path.join(f.directory, 'test-results/j1d-smoke', name), 'utf8'));
            expect(receipt).toMatchObject({ role: 'playwright-smoke-producer', lineage: { source: 'github-actions', runId: '9001', runAttempt: '2', job: 'j1d-smoke' },
                terminalStatus: 'passed', rawReplayError: null, beginCalls: 1, endCalls: 1, errorCalls: 0 });
            expect(receipt.source.commit).toBe(f.git(['rev-parse', 'HEAD']));
            expect(receipt.collection.map((test: { file: string }) => test.file).sort()).toEqual([...SMOKE_SPECS].sort());
            const blob = fs.readFileSync(path.join(f.directory, 'blob-report', receipt.blob.name));
            const tests = replaySmokeBlob(await readBlobReport(f.directory, blob), { repositoryRoot: f.directory, commit: receipt.source.commit });
            expect(tests).toEqual(receipt.collection);
            const prefix = 'artifacts/j1d-smoke-evidence-9001-2';
            f.write(`${prefix}/test-results/j1d-smoke/${name}`, JSON.stringify(receipt));
            f.write(`${prefix}/blob-report/${receipt.blob.name}`, blob);
            const expected = executionContext(f.directory, { ...f.env(), SOFTWARE_QUALITY_INVOCATION: 'a'.repeat(36) });
            expect(() => collectSmokeExecution({ root: f.directory, expected })).toThrow(/destroyed.json/);
            const binding = smokeBinding(f.env(), expected.commit);
            const proof = { ...buildTeardownProof({
                binding, identity: { project: smokeProjectFor(binding), containers: ['c1'], volumes: [], networks: [] },
                identityText: 'fixture identity', checks: [{ kind: 'container', id: 'c1', absent: true }],
                remaining: { containers: 0, volumes: 0, networks: 0 }, stopExit: 0,
            }), identitySha256: receipt.identitySha256 };
            f.write(`${prefix}/destroyed.json`, JSON.stringify(proof));
            const wrapper = collectSmokeExecution({ root: f.directory, expected });
            expect([...validateSmokeExecution(wrapper, { root: f.directory, expected })].sort()).toEqual([...SMOKE_SPECS].sort());
            for (const forged of [
                { ...proof, binding: { ...binding, runAttempt: '1' } },
                { ...proof, identitySha256: 'b'.repeat(64) },
                { ...proof, recorded: { ...proof.recorded, containers: '1' } },
                { ...proof, remaining: { ...proof.remaining, volumes: 1 } },
            ]) {
                const attempted = { ...wrapper, teardown: forged, teardownSha256: sha256(JSON.stringify(forged)) };
                expect(() => validateSmokeExecution(attempted, { root: f.directory, expected })).toThrow(/teardown/);
            }
            expect(() => validateSmokeExecution({ ...wrapper, blobBase64: Buffer.from('garbage').toString('base64') },
                { root: f.directory, expected })).toThrow(/blob bytes/);
            const wrongProducer = { ...wrapper.producer, lineage: { ...wrapper.producer.lineage, job: 'e2e' } };
            expect(() => validateSmokeExecution({ ...wrapper, producer: wrongProducer, producerSha256: sha256(JSON.stringify(wrongProducer)) },
                { root: f.directory, expected })).toThrow(/producer source/);
        } finally { f.clean(); }
    }, 120_000);

    it('NEGATIVE: outside the j1d-smoke job, or with a failing body, no creditable receipt is produced', () => {
        const f = smokeFixture();
        try {
            // Playwright does not fail the process when a reporter throws; what matters is that NO receipt exists, so the gate,
            // which requires one, refuses (a missing producer is never a pass).
            const otherJob = f.run('e2e');
            expect(`${otherJob.stdout}\n${otherJob.stderr}`).toMatch(/Missing exact j1d-smoke CI lineage/);
            expect(f.receipts()).toEqual([]);
            f.write('tests/smoke/owned.smoke.spec.ts', f.body(false)); f.commit();
            const failing = f.run();
            expect(failing.status).not.toBe(0);
            for (const name of f.receipts()) {
                const r = JSON.parse(fs.readFileSync(path.join(f.directory, 'test-results/j1d-smoke', name), 'utf8'));
                expect(r.terminalStatus === 'passed' && r.rawReplayError === null).toBe(false);
            }
        } finally { f.clean(); }
    }, 120_000);
});



it('only smoke paths, runner or config changes select the dedicated disposable job', () => {
    expect(smokeAffected(['tests/e2e/infra.probe.e2e.spec.ts', 'docs/README.md'])).toBe(false);
    for (const file of ['tests/smoke/delete.smoke.spec.ts', 'tests/smoke/smokePage.ts', 'scripts/j1d-smoke/stack.sh',
        'playwright.j1d-smoke.config.ts', '.github/workflows/j1d-reserved-namespace-smoke.yml']) {
        expect(smokeAffected([file])).toBe(true);
    }
});
