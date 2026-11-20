// Reopen the exact disposable producer artifacts, not a summary, score or workflow job conclusion.
import fs from 'node:fs';
import path from 'node:path';
import { digest, MAX_BLOB_BYTES, MAX_REPORT_BYTES, playwrightRuntimeIdentity, readArtifact, replayEmbeddedBlob } from '../lib/playwrightExecutionEvidence.mjs';
import { replaySmokeBlob, SMOKE_JOB, SMOKE_SPECS, teardownProofVerdict } from './smokeEvidence.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const runId = /^[1-9]\d*$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{64}$/;
function artifactPrefix(expected) {
    if (expected?.source !== 'github-actions' || !runId.test(expected.runId) || !runId.test(expected.runAttempt)) {
        throw new Error('Disposable smoke evidence requires exact CI run and attempt');
    }
    return `artifacts/j1d-smoke-evidence-${expected.runId}-${expected.runAttempt}`;
}
function canonical(bytes) {
    const text = bytes.toString('utf8');
    const result = JSON.parse(text);
    if (JSON.stringify(result) !== text) throw new Error('Noncanonical disposable smoke producer');
    return result;
}

export function collectSmokeExecution({ root, expected }) {
    const prefix = artifactPrefix(expected);
    const receiptNames = fs.readdirSync(path.join(root, prefix, 'test-results/j1d-smoke'))
        .filter(name => name.startsWith('smoke-execution-') && name.endsWith('.json'));
    const blobNames = fs.readdirSync(path.join(root, prefix, 'blob-report')).filter(name => name.endsWith('.zip'));
    if (receiptNames.length !== 1 || blobNames.length !== 1) throw new Error('Missing or ambiguous disposable smoke producer/blob');
    const receiptPath = `${prefix}/test-results/j1d-smoke/${receiptNames[0]}`;
    const blobPath = `${prefix}/blob-report/${blobNames[0]}`;
    const teardownPath = `${prefix}/destroyed.json`;
    const receipt = readArtifact(root, receiptPath, MAX_REPORT_BYTES);
    const blob = readArtifact(root, blobPath, MAX_BLOB_BYTES);
    const teardown = readArtifact(root, teardownPath, 32 * 1024);
    const wrapper = { schemaVersion: 1, role: 'disposable-smoke-wrapper', provenance: expected, receiptPath, blobPath, teardownPath,
        producer: canonical(receipt), producerSha256: digest(receipt), blobBase64: blob.toString('base64'),
        teardown: JSON.parse(teardown.toString('utf8')), teardownSha256: digest(JSON.stringify(JSON.parse(teardown.toString('utf8')))) };
    validateSmokeExecution(wrapper, { root, expected });
    return wrapper;
}

export function validateSmokeExecution(wrapper, { root, expected, requiredFiles = SMOKE_SPECS }) {
    const prefix = artifactPrefix(expected);
    const p = wrapper?.producer;
    if (wrapper?.schemaVersion !== 1 || wrapper.role !== 'disposable-smoke-wrapper' || !same(wrapper.provenance, expected)
        || p?.schemaVersion !== 1 || p.role !== 'playwright-smoke-producer' || !uuid.test(p.producerId ?? '')
        || !hex.test(p.identitySha256 ?? '') || Object.hasOwn(p, 'invocation') || Object.hasOwn(p, 'shard')
        || !same(p.source, { commit: expected.commit, tree: expected.tree, snapshotSha256: expected.snapshotSha256 })
        || !same(p.lineage, { source: expected.source, runId: expected.runId, runAttempt: expected.runAttempt, job: SMOKE_JOB })
        || !same(p.runtime, playwrightRuntimeIdentity(root)) || p.lockSha256 !== digest(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')))) {
        throw new Error('Wrong disposable smoke producer source/runtime/run/attempt');
    }
    const blobName = p.blob?.name;
    if (typeof blobName !== 'string' || !/^report[A-Za-z0-9._-]*\.zip$/.test(blobName)
        || wrapper.receiptPath !== `${prefix}/test-results/j1d-smoke/smoke-execution-${expected.runId}-${expected.runAttempt}-${p.producerId}.json`
        || wrapper.blobPath !== `${prefix}/blob-report/${blobName}` || wrapper.teardownPath !== `${prefix}/destroyed.json`
        || wrapper.producerSha256 !== digest(JSON.stringify(p))) {
        throw new Error('Disposable smoke artifact identity differs');
    }
    if (typeof wrapper.blobBase64 !== 'string' || wrapper.blobBase64.length > Math.ceil(MAX_BLOB_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(wrapper.blobBase64)) throw new Error('Invalid embedded smoke blob');
    const blob = Buffer.from(wrapper.blobBase64, 'base64');
    if (blob.toString('base64') !== wrapper.blobBase64 || blob.length !== p.blob.bytes || digest(blob) !== p.blob.sha256) {
        throw new Error('Original disposable smoke blob bytes changed');
    }
    const raw = replayEmbeddedBlob(root, blob);
    if (digest(raw) !== p.blob.reportSha256) throw new Error('Original disposable smoke ledger differs');
    const tests = replaySmokeBlob(raw, { repositoryRoot: p.repositoryRoot, commit: expected.commit });
    if (!same(tests, p.collection) || p.beginCalls !== 1 || p.endCalls !== 1 || p.errorCalls !== 0
        || p.terminalStatus !== 'passed' || p.rawReplayError !== null || !Array.isArray(p.begins) || !Array.isArray(p.ends)
        || p.begins.length !== tests.length || p.ends.length !== tests.length) throw new Error('Incomplete disposable smoke producer lifecycle');
    for (const { id } of tests) {
        const begins = p.begins.filter(item => item.id === id);
        const ends = p.ends.filter(item => item.id === id);
        if (begins.length !== 1 || ends.length !== 1 || begins[0].retry !== 0 || ends[0].retry !== 0
            || ends[0].status !== 'passed' || ends[0].expectedStatus !== 'passed' || ends[0].errors !== 0) {
            throw new Error('Missing, retried, skipped or failed disposable smoke test');
        }
    }
    const t = wrapper.teardown;
    if (wrapper.teardownSha256 !== digest(JSON.stringify(t ?? null))
        || !['containers', 'volumes', 'networks'].every(k => Number.isSafeInteger(t?.recorded?.[k]) && t.recorded[k] >= 0)
        || t.recorded.containers < 1
        || teardownProofVerdict(t, { ...expected, identitySha256: p.identitySha256 }).status !== 'PASS') {
        throw new Error('Disposable smoke teardown was not proved for this stack');
    }
    const files = new Set(tests.map(test => test.file));
    if ([...SMOKE_SPECS, ...requiredFiles].some(file => !files.has(file))) throw new Error('Required disposable smoke file was not executed');
    return files;
}
