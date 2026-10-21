import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CANONICAL_PRODUCTION_ORIGIN, extractDeployedRelease } from './lib/releaseEvidenceEligibility.mjs';

const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = 'relativityE/speaksharp';
export const REQUIRED_RELEASE_JOBS = ['build', 'edge-tests', 'unit-coverage-merge', 'health-check',
    'full-evidence', 'exact-head-review-qualification', 'merge-qualification',
    ...[1, 2, 3, 4].flatMap((shard) => [`unit-shard-${shard}`, `e2e-shard-${shard}`])];

async function boundedBody(response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing body');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let text = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) return text + decoder.decode();
            size += value.byteLength;
            if (size > 2_000_000) throw new Error('body limit');
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        void reader.cancel().catch(() => {});
    }
}

export function releaseIntent(input = {}) {
    if (input.deployProduction === false || input.deployProduction === 'false'
        || input.deployProduction === undefined || input.deployProduction === '') {
        return { allowed: false, state: 'OFF' };
    }
    if (input.deployProduction !== true && input.deployProduction !== 'true') {
        return { allowed: false, state: 'HOLD' };
    }
    return input.eventName === 'workflow_dispatch' && input.ref === 'refs/heads/main'
        && input.repository === REPOSITORY && SHA.test(input.expectedSha ?? '')
        && input.resolvedSha === input.expectedSha
        ? { allowed: true, state: 'INTENT' } : { allowed: false, state: 'HOLD' };
}

// Read-only qualification. No provider credential, production environment or mutation belongs here.
// In particular, false/missing inputs return BEFORE invoking even the GitHub reader.
export async function authorizeProductionRelease(input, readGithub) {
    const intent = releaseIntent(input);
    if (!intent.allowed) return intent;
    try {
        const prefix = `/repos/${REPOSITORY}`;
        const main = await readGithub(`${prefix}/git/ref/heads/main`);
        if (main.object?.sha !== input.expectedSha) return { allowed: false, state: 'HOLD' };
        const runs = await readGithub(`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${input.expectedSha}&per_page=100`);
        if (!Array.isArray(runs.workflow_runs)) throw new Error('missing runs');
        // Never choose an older success over a newer failure, pending run or rerun.
        const candidates = runs.workflow_runs.filter((run) => run.head_sha === input.expectedSha
            && run.head_branch === 'main' && run.event === 'push');
        candidates.sort((a, b) => b.id - a.id);
        const run = candidates[0];
        if (!Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run?.run_attempt)
            || run.run_attempt < 1 || run.status !== 'completed' || run.conclusion !== 'success') {
            return { allowed: false, state: 'HOLD' };
        }
        const jobs = [];
        for (let page = 1; page <= 10; page++) {
            const result = await readGithub(`${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
            if (!Array.isArray(result.jobs)) throw new Error('missing jobs');
            jobs.push(...result.jobs);
            if (result.jobs.length < 100) break;
            if (page === 10) throw new Error('incomplete pagination');
        }
        const passed = (name) => jobs.filter((job) => job.name === name).length === 1
            && jobs.find((job) => job.name === name).status === 'completed'
            && jobs.find((job) => job.name === name).conclusion === 'success';
        if (!REQUIRED_RELEASE_JOBS.every(passed)) {
            return { allowed: false, state: 'HOLD' };
        }
        // Recheck after qualification reads; callers also recheck immediately before mutation.
        const latest = await readGithub(`${prefix}/git/ref/heads/main`);
        if (latest.object?.sha !== input.expectedSha) return { allowed: false, state: 'HOLD' };
        return { allowed: true, state: 'QUALIFIED', releaseSha: input.expectedSha, ciRunId: run.id, ciAttempt: run.run_attempt };
    } catch {
        return { allowed: false, state: 'HOLD' };
    }
}

export async function verifyServedRelease(expectedSha, fetchImpl = globalThis.fetch) {
    if (!SHA.test(expectedSha ?? '')) return { allowed: false, state: 'HOLD' };
    try {
        const response = await fetchImpl(`${CANONICAL_PRODUCTION_ORIGIN}/`, {
            redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { accept: 'text/html', 'cache-control': 'no-cache' },
        });
        if (!response.ok) throw new Error('unavailable');
        const html = await boundedBody(response);
        const markers = [...html.matchAll(/window\.__APP_RELEASE__\s*=/g)];
        if (markers.length !== 1 || extractDeployedRelease(html) !== expectedSha) throw new Error('unbound');
        return { allowed: true, state: 'SERVED', releaseSha: expectedSha };
    } catch {
        return { allowed: false, state: 'HOLD' };
    }
}

export function inputFromEnvironment(env) {
    return { deployProduction: env.DEPLOY_PRODUCTION, eventName: env.GITHUB_EVENT_NAME,
        ref: env.GITHUB_REF, repository: env.GITHUB_REPOSITORY,
        expectedSha: env.EXPECTED_HEAD_SHA, resolvedSha: env.GITHUB_SHA };
}

async function readGithub(path) {
    if (!process.env.GH_TOKEN) throw new Error('missing read token');
    const response = await fetch(`https://api.github.com${path}`, {
        redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error('read unavailable');
    return JSON.parse(await boundedBody(response));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const command = process.argv[2];
    const result = command === 'authorize'
        ? await authorizeProductionRelease(inputFromEnvironment(process.env), readGithub)
        : command === 'served' ? await verifyServedRelease(process.env.EXPECTED_RELEASE_SHA)
            : { allowed: false, state: 'HOLD' };
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${result.allowed}\nrelease_sha=${result.releaseSha ?? ''}\n`);
    }
    console.log(JSON.stringify(result));
    // OFF is an explicit no-op, never qualification. HOLD must remain distinguishable from PASS.
    process.exitCode = result.allowed || result.state === 'OFF' ? 0 : 1;
}
