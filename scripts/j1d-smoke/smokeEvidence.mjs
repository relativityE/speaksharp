// J1.d reserved-namespace smoke: the smoke side of its execution evidence. Pure functions only.
//
// The gate may credit tests/smoke/*.smoke.spec.ts ONLY from the actual disposable run's own Playwright evidence, bound to the
// exact commit and the run id and attempt of the job that produced it, together with a CHECKED teardown proof of that same
// run's stack. This module replays the raw SDK blob of that single run (never final totals) and builds and judges the teardown
// proof. The four ordinary E2E shards and their validator (scripts/lib/playwrightExecutionEvidence.mjs) are untouched.
import path from 'node:path';
import { createHash } from 'node:crypto';

export const SMOKE_JOB = 'j1d-smoke';
export const SMOKE_PROJECT = 'j1d-smoke';
export const SMOKE_FILE = /^tests\/smoke\/.+\.smoke\.spec\.ts$/;
export const SMOKE_CONFIG = 'playwright.j1d-smoke.config.ts';
export const SMOKE_WORKFLOW = '.github/workflows/j1d-reserved-namespace-smoke.yml';
export const SMOKE_SPECS = Object.freeze(['tests/smoke/j1d-reserved-domain.smoke.spec.ts', 'tests/smoke/j1ef-trial-wall.smoke.spec.ts']);
export const SMOKE_HELPERS = Object.freeze(['tests/smoke/j1dSmokeChecks.ts', 'tests/smoke/j1efTrialChecks.ts', 'tests/smoke/smokePage.ts']);
export const smokeAffected = (files) => files.some(file => file === SMOKE_CONFIG || file === SMOKE_WORKFLOW
    || file.startsWith('tests/smoke/') || file.startsWith('scripts/j1d-smoke/'));
export const PLAYWRIGHT_VERSION = '1.57.0';
export const SMOKE_TEARDOWN_SCHEMA = 'j1d-smoke-teardown/v1';
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** The repository-relative smoke file a collected test belongs to; anything outside tests/smoke/*.smoke.spec.ts refuses. */
export function smokeEvidenceFile(root, rootDir, file) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || typeof rootDir !== 'string' || !path.isAbsolute(rootDir)
        || typeof file !== 'string' || !file || file.includes('\\')) throw new Error('Malformed smoke file identity');
    const relative = path.relative(root, path.resolve(rootDir, file)).split(path.sep).join('/');
    if (!SMOKE_FILE.test(relative) || relative.split('/').includes('..')) throw new Error('Playwright collection outside the smoke scope');
    return relative;
}

/**
 * Replay the single smoke run's raw SDK events. Credit requires: the pinned Playwright runtime; no shard; exactly one project named
 * j1d-smoke; the blob's commit (when the SDK records one) equal to `commit`; one onBegin and one onEnd with a passed result; no
 * onError; and every collected test begun once (retry 0) and ended once, passed, expected to pass, with no error. Returns the
 * collected tests; anything else throws.
 */
export function replaySmokeBlob(jsonl, { repositoryRoot, commit } = {}) {
    if (typeof jsonl !== 'string' || jsonl.length > 64 * 1024 * 1024) throw new Error('Invalid raw Playwright report');
    let records;
    try { records = jsonl.trim().split('\n').map((line) => JSON.parse(line)); } catch (cause) { throw new Error('Malformed Playwright JSONL', { cause }); }
    const unique = (method) => {
        const matches = records.filter((item) => item.method === method);
        if (matches.length !== 1) throw new Error(`Missing/duplicate Playwright ${method}`);
        return matches[0].params;
    };
    const metadata = unique('onBlobReportMetadata');
    const config = unique('onConfigure')?.config;
    if (metadata?.version !== 2 || !metadata.userAgent?.startsWith(`Playwright/${PLAYWRIGHT_VERSION} `) || config?.version !== PLAYWRIGHT_VERSION) {
        throw new Error('Wrong blob/runtime identity');
    }
    if (metadata.shard !== undefined && metadata.shard !== null) throw new Error('A smoke run is never sharded');
    for (const value of [config?.metadata?.ci?.commitHash, config?.metadata?.gitCommit?.hash]) {
        if (value !== undefined && value !== commit) throw new Error('Wrong blob source commit');
    }
    unique('onBegin');
    const terminal = unique('onEnd');
    if (terminal?.result?.status !== 'passed' || records.some((item) => item.method === 'onError')) throw new Error('Playwright error or incomplete terminal result');
    const projects = records.filter((item) => item.method === 'onProject').map((item) => item.params?.project);
    if (projects.length !== 1 || projects[0]?.name !== SMOKE_PROJECT || !Array.isArray(projects[0].suites)) throw new Error('Wrong Playwright project');
    const collected = new Map();
    const visit = (suite) => {
        if (!Array.isArray(suite.entries)) throw new Error('Missing raw Playwright collection');
        for (const entry of suite.entries) {
            if (entry.testId) {
                if (typeof entry.testId !== 'string' || typeof entry.title !== 'string' || entry.repeatEachIndex !== 0 || collected.has(entry.testId)) {
                    throw new Error('Duplicate/repeated/malformed Playwright test');
                }
                collected.set(entry.testId, { id: entry.testId, file: smokeEvidenceFile(repositoryRoot, config.rootDir, entry.location?.file), title: entry.title });
            } else visit(entry);
        }
    };
    projects[0].suites.forEach(visit);
    if (collected.size === 0) throw new Error('No smoke test collected');
    const begun = new Map(); const ended = new Set(); let active = false; let closed = false;
    for (const event of records) {
        if (event.method === 'onBegin') { active = true; continue; }
        if (event.method === 'onEnd') { closed = true; continue; }
        if (!['onTestBegin', 'onTestEnd'].includes(event.method)) continue;
        if (!active || closed) throw new Error('Test callback outside run lifecycle');
        const p = event.params;
        const id = event.method === 'onTestBegin' ? p?.testId : p?.test?.testId;
        if (!collected.has(id)) throw new Error('Uncollected Playwright test callback');
        if (event.method === 'onTestBegin') {
            if (begun.has(id) || p.result?.retry !== 0 || typeof p.result?.id !== 'string') throw new Error('Duplicate/retried/missing test begin');
            begun.set(id, p.result.id);
        } else {
            if (!begun.has(id) || ended.has(id) || p.result?.id !== begun.get(id) || p.test?.expectedStatus !== 'passed'
                || p.result?.status !== 'passed' || !Array.isArray(p.result.errors) || p.result.errors.length) throw new Error('Failed/skipped/incomplete test terminal');
            ended.add(id);
        }
    }
    if (begun.size !== collected.size || ended.size !== collected.size) throw new Error('Incomplete Playwright collection execution');
    return [...collected.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The run a teardown or producer belongs to: the exact commit and, in Actions, the run id and attempt (else `local`). */
export function smokeBinding(env, commit) {
    const actions = env.GITHUB_ACTIONS === 'true';
    const runId = actions ? env.GITHUB_RUN_ID : 'local';
    const runAttempt = actions ? env.GITHUB_RUN_ATTEMPT : 'local';
    if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Smoke binding needs the exact commit');
    if (actions && (!/^\d+$/.test(runId ?? '') || !/^\d+$/.test(runAttempt ?? ''))) throw new Error('Smoke binding needs the run id and attempt');
    return { source: actions ? 'github-actions' : 'local', commit, runId, runAttempt };
}

/** The stack's project name for a binding: in Actions it embeds the run id and attempt, so a proof names its own run's stack. */
export const smokeProjectFor = (binding, localRun) => (binding.source === 'github-actions' ? `j1d-smoke-${binding.runId}-${binding.runAttempt}` : `j1d-smoke-${localRun}`);

/**
 * The CHECKED teardown result for one run's stack: every container, volume and network recorded after creation answered Docker's
 * own not-found, and the stack's label selectors are empty, after a stop that exited 0. Never a bare `destroyed: true`.
 *   identity: { project, containers[], volumes[], networks[] } as recorded after `supabase start`
 *   checks:   { kind, id, absent } for each recorded identity, from `docker <kind> inspect`
 *   remaining: counts the label selectors return now; stopExit: the checked `supabase stop` exit code
 */
export function buildTeardownProof({ binding, identity, identityText, checks, remaining, stopExit }) {
    const recorded = { containers: identity.containers.length, volumes: identity.volumes.length, networks: identity.networks.length };
    const absent = checks.filter((c) => c.absent).length;
    const total = recorded.containers + recorded.volumes + recorded.networks;
    const left = (total - absent) + remaining.containers + remaining.volumes + remaining.networks;
    return {
        schema: SMOKE_TEARDOWN_SCHEMA, binding, project: identity.project, identitySha256: sha256(identityText),
        stop: { checked: true, exit: stopExit }, recorded, checked: { absent, total }, remaining, left,
        destroyed: stopExit === 0 && total > 0 && left === 0 && checks.length === total,
    };
}

/**
 * Pure: a teardown proof the gate may accept for THIS browser run. It must be the checked schema, bound to the same commit, run
 * id and attempt as the browser evidence, name that run's own stack, and show a checked stop, every recorded resource absent and
 * the selectors empty. A plain `{ destroyed: true }`, another head or attempt, or anything unchecked is refused.
 */
export function teardownProofVerdict(proof, expected) {
    if (!proof || typeof proof !== 'object' || proof.schema !== SMOKE_TEARDOWN_SCHEMA) return { status: 'HOLD', reason: 'teardown_unchecked' };
    const b = proof.binding ?? {};
    if (b.commit !== expected.commit) return { status: 'HOLD', reason: 'teardown_other_commit' };
    if (b.source !== expected.source || b.runId !== expected.runId || b.runAttempt !== expected.runAttempt) return { status: 'HOLD', reason: 'teardown_other_run' };
    if (expected.source === 'github-actions' && proof.project !== smokeProjectFor(b)) return { status: 'HOLD', reason: 'teardown_other_stack' };
    if (expected.identitySha256 !== undefined && proof.identitySha256 !== expected.identitySha256) return { status: 'HOLD', reason: 'teardown_identity_differs' };
    if (proof.stop?.checked !== true || proof.stop.exit !== 0) return { status: 'FAIL', reason: 'teardown_stop_failed' };
    const r = proof.recorded ?? {};
    const total = (r.containers ?? 0) + (r.volumes ?? 0) + (r.networks ?? 0);
    if (!(total > 0) || proof.checked?.total !== total) return { status: 'HOLD', reason: 'teardown_nothing_recorded' };
    const remaining = proof.remaining ?? {};
    if (proof.checked.absent !== total || proof.left !== 0 || remaining.containers !== 0 || remaining.volumes !== 0 || remaining.networks !== 0) {
        return { status: 'FAIL', reason: 'teardown_left_resources' };
    }
    return proof.destroyed === true ? { status: 'PASS', reason: 'stack_destroyed' } : { status: 'FAIL', reason: 'teardown_not_destroyed' };
}
