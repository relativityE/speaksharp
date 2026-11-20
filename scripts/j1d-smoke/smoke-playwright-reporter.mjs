// J1.d smoke producer: the disposable run's OWN Playwright evidence, for the gate to credit
// tests/smoke/*.smoke.spec.ts. Mirrors scripts/efficacy-playwright-reporter.mjs (unchanged) for one unsharded smoke run:
// it binds the exact commit, tree, snapshot, lockfile and Playwright runtime to the j1d-smoke job's run id and attempt, records
// every callback, re-reads the raw SDK blob, and writes test-results/j1d-smoke/smoke-execution-<run>-<attempt>-<producer>.json.
// It refuses outside that exact CI lineage, so a local or Codespace run never produces creditable evidence.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceIdentity } from '../lib/testExecutionEvidence.mjs';
import { digest, playwrightRuntimeIdentity, readBlobReport } from '../lib/playwrightExecutionEvidence.mjs';
import { SMOKE_FILE, SMOKE_JOB, replaySmokeBlob } from './smokeEvidence.mjs';

export default class SmokePlaywrightReporter {
    producerId = randomUUID();
    beginCalls = 0; endCalls = 0; errorCalls = 0;
    collection = []; begins = []; ends = [];
    initialize(config) {
        if (!config.configFile) throw new Error('Missing Playwright config identity');
        this.root = fs.realpathSync(path.dirname(config.configFile));
        const source = sourceIdentity(this.root);
        if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_JOB !== SMOKE_JOB
            || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '')
            || process.env.GITHUB_SHA !== source.commit) throw new Error('Missing exact j1d-smoke CI lineage');
        if (config.shard) throw new Error('The smoke producer is never sharded');
        const identity = process.env.J1D_SMOKE_IDENTITY_SHA256;
        if (!/^[a-f0-9]{64}$/.test(identity ?? '')) throw new Error('Smoke stack identity required');
        this.identitySha256 = identity;
        this.source = source;
        this.runtime = playwrightRuntimeIdentity(this.root);
        this.lockSha256 = digest(fs.readFileSync(path.join(this.root, 'pnpm-lock.yaml')));
        this.lineage = { source: 'github-actions', runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB };
    }
    onBegin(config, suite) {
        this.initialize(config);
        this.beginCalls++;
        this.collection = suite.allTests().map((test) => {
            const file = path.relative(this.root, fs.realpathSync(test.location.file)).split(path.sep).join('/');
            if (!SMOKE_FILE.test(file)) throw new Error('Non-smoke test in the smoke producer');
            return { id: test.id, file, title: test.title };
        }).sort((a, b) => a.id.localeCompare(b.id));
    }
    onTestBegin(test, result) { this.begins.push({ id: test.id, retry: result.retry }); }
    onTestEnd(test, result) { this.ends.push({ id: test.id, retry: result.retry, status: result.status, expectedStatus: test.expectedStatus, errors: result.errors.length }); }
    onError() { this.errorCalls++; }
    onEnd(result) { this.endCalls++; this.terminalStatus = result.status; }
    async onExit() {
        const dir = path.join(this.root, 'blob-report');
        const names = fs.readdirSync(dir).filter((name) => name.endsWith('.zip'));
        if (names.length !== 1) throw new Error('Missing or ambiguous smoke blob');
        const bytes = fs.readFileSync(path.join(dir, names[0]));
        const jsonl = await readBlobReport(this.root, bytes);
        let rawReplayError = null;
        try {
            const replay = replaySmokeBlob(jsonl, { repositoryRoot: this.root, commit: this.source.commit });
            if (JSON.stringify(replay) !== JSON.stringify(this.collection)) throw new Error('Producer collection differs from raw SDK collection');
        } catch (error) { rawReplayError = error.message; }
        if (JSON.stringify(sourceIdentity(this.root)) !== JSON.stringify(this.source)
            || JSON.stringify(playwrightRuntimeIdentity(this.root)) !== JSON.stringify(this.runtime)
            || digest(fs.readFileSync(path.join(this.root, 'pnpm-lock.yaml'))) !== this.lockSha256) throw new Error('Smoke producer source/lock/runtime changed');
        const receipt = { schemaVersion: 1, role: 'playwright-smoke-producer', producerId: this.producerId,
            repositoryRoot: this.root, identitySha256: this.identitySha256, source: this.source, lineage: this.lineage, runtime: this.runtime, lockSha256: this.lockSha256,
            collection: this.collection, beginCalls: this.beginCalls, endCalls: this.endCalls, errorCalls: this.errorCalls,
            begins: this.begins, ends: this.ends, terminalStatus: this.terminalStatus, rawReplayError,
            blob: { name: names[0], bytes: bytes.length, sha256: digest(bytes), reportSha256: digest(jsonl) } };
        const output = path.join(this.root, 'test-results/j1d-smoke');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, `smoke-execution-${this.lineage.runId}-${this.lineage.runAttempt}-${this.producerId}.json`), JSON.stringify(receipt), { encoding: 'utf8', flag: 'wx' });
        if (rawReplayError) throw new Error(`Unqualified raw smoke run: ${rawReplayError}`);
    }
}
