// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { load } from 'js-yaml';
import { authorizeProductionRelease, releaseIntent, verifyServedRelease, REQUIRED_RELEASE_JOBS } from '../../scripts/production-release-policy.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const intent = { deployProduction: true, eventName: 'workflow_dispatch', ref: 'refs/heads/main',
    repository: 'relativityE/speaksharp', expectedSha: SHA, resolvedSha: SHA };
const requiredJobs = ['build', 'edge-tests', 'unit-coverage-merge', 'health-check', 'full-evidence',
    'exact-head-review-qualification', 'merge-qualification',
    ...[1, 2, 3, 4].flatMap((shard) => [`unit-shard-${shard}`, `e2e-shard-${shard}`])];
function fixture({ main = SHA, finalMain = main, conclusion = 'success', status = 'completed',
    jobs = requiredJobs.map((name) => ({ name, status: 'completed', conclusion: 'success' })), runs } = {}) {
    let mainReads = 0;
    return vi.fn(async (path) => {
        if (path.endsWith('/git/ref/heads/main')) return { object: { sha: mainReads++ ? finalMain : main } };
        if (path.includes('/workflows/ci.yml/runs?')) return { workflow_runs: runs ?? [
            { id: 123, run_attempt: 2, head_sha: SHA, head_branch: 'main', event: 'push', status, conclusion },
        ] };
        if (path.endsWith('/runs/123/attempts/2/jobs?per_page=100&page=1')) return { jobs };
        throw new Error('unexpected read');
    });
}

describe('actual production gate: default off and exact completed qualification', () => {
    it.each([undefined, '', false, 'false'])('missing/false %s does not even invoke the GitHub reader', async (deployProduction) => {
        const reader = vi.fn();
        expect(await authorizeProductionRelease({ ...intent, deployProduction }, reader)).toEqual({ allowed: false, state: 'OFF' });
        expect(reader).not.toHaveBeenCalled();
    });
    it.each(['TRUE', '1', 1, null, {}, [], ' true '])('malformed flag %j is never permission', async (deployProduction) => {
        const reader = vi.fn();
        expect(await authorizeProductionRelease({ ...intent, deployProduction }, reader)).toEqual({ allowed: false, state: 'HOLD' });
        expect(reader).not.toHaveBeenCalled();
    });
    it.each([
        { eventName: 'push' }, { eventName: 'pull_request' }, { eventName: 'schedule' },
        { ref: 'refs/heads/feature' }, { ref: 'refs/tags/main' }, { repository: 'foreign/repo' },
        { expectedSha: 'main' }, { expectedSha: 'A'.repeat(40) }, { resolvedSha: OTHER },
    ])('rejects untrusted event/ref/source before reads: %j', async (override) => {
        const reader = vi.fn();
        expect((await authorizeProductionRelease({ ...intent, ...override }, reader)).allowed).toBe(false);
        expect(reader).not.toHaveBeenCalled();
    });
    it('qualifies only the exact current main and latest complete CI attempt', async () => {
        const reader = fixture();
        expect(await authorizeProductionRelease(intent, reader)).toEqual({ allowed: true, state: 'QUALIFIED', releaseSha: SHA, ciRunId: 123, ciAttempt: 2 });
        expect(reader.mock.calls[1][0]).toContain(`event=push&head_sha=${SHA}`);
        expect(reader.mock.calls[2][0]).toContain('/attempts/2/jobs');
    });
    it.each(['failure', 'cancelled', 'skipped', null])('non-success CI %s cannot authorize', async (conclusion) => {
        expect((await authorizeProductionRelease(intent, fixture({ conclusion }))).allowed).toBe(false);
    });
    it.each(['in_progress', 'queued', 'waiting'])('pending CI %s cannot authorize', async (status) => {
        expect((await authorizeProductionRelease(intent, fixture({ status }))).allowed).toBe(false);
    });
    it('does not reuse old success when a newer run failed', async () => {
        const good = { id: 123, run_attempt: 2, head_sha: SHA, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' };
        expect((await authorizeProductionRelease(intent, fixture({ runs: [good, { ...good, id: 124, conclusion: 'failure' }] }))).allowed).toBe(false);
    });
    it.each(requiredJobs)('missing required full-lane job %s is HOLD', async (missing) => {
        const jobs = requiredJobs.filter((name) => name !== missing).map((name) => ({ name, status: 'completed', conclusion: 'success' }));
        expect((await authorizeProductionRelease(intent, fixture({ jobs }))).allowed).toBe(false);
    });
    it('main advancing during reads prevents qualification', async () => {
        expect((await authorizeProductionRelease(intent, fixture({ finalMain: OTHER }))).allowed).toBe(false);
    });
    it('read failure stays bounded without leaking response/error content', async () => {
        expect(await authorizeProductionRelease(intent, async () => { throw new Error('private-value'); }))
            .toEqual({ allowed: false, state: 'HOLD' });
    });
    it.each(['failure', 'skipped', null])('even one non-success shard %s prevents release', async (conclusion) => {
        const jobs = requiredJobs.map((name) => ({ name, status: 'completed', conclusion: name === 'e2e-shard-4' ? conclusion : 'success' }));
        expect((await authorizeProductionRelease(intent, fixture({ jobs }))).allowed).toBe(false);
    });
    it('actual CLI missing flag is OFF without credentials/network', () => {
        const result = spawnSync(process.execPath, ['scripts/production-release-policy.mjs', 'authorize'], { env: {}, encoding: 'utf8', timeout: 5000 });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ allowed: false, state: 'OFF' });
        expect(result.stderr).toBe('');
    });
});

// Execute the expressions actually assigned to credential-bearing jobs. Even if an upstream output
// were forged as allowed, the direct false/missing input must prevent environment/secret admission.
function condition(expression, flag, allowed = 'true', operation = 'all') {
    const needs = new Proxy({}, { get: () => ({ result: 'success', outputs: { allowed, deploy_edge_functions: 'true' } }) });
    const script = String(expression).replace(/^\$\{\{\s*|\s*\}\}$/g, '')
        .replace(/needs\.([\w-]+)\./g, 'needs["$1"].');
    return runInNewContext(script, { inputs: { deploy_production: flag, operation }, needs,
        github: { event_name: 'workflow_dispatch', ref: 'refs/heads/main' }, always: () => true }, { timeout: 100 });
}
const workflow = (name) => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
describe('production workflow admission before production environments and secrets', () => {
    it('release qualification includes every actual CI unit and browser matrix member', () => {
        const ci = workflow('ci');
        for (const [id, prefix] of [['unit-shard', 'unit-shard'], ['e2e', 'e2e-shard']]) {
            for (const shard of ci.jobs[id].strategy.matrix.shard) {
                expect(REQUIRED_RELEASE_JOBS).toContain(`${prefix}-${shard}`);
            }
        }
    });
    for (const [name, jobs, gate] of [
        ['deploy-supabase-migrations', ['invalidate-account-closure-authority', 'deploy-edge-functions', 'verify-edge-functions', 'deploy-production-db'], 'validate-edge-configuration'],
        ['apply-exact-allowlisted-migration', ['apply-one-allowlisted-migration'], 'production-policy'],
        ['apply-webhook-db-prerequisite', ['apply-exact-webhook-prerequisite'], 'production-policy'],
        ['production-release', ['release-edge', 'release-frontend'], 'production-policy'],
    ]) {
        it(`${name}: default off plus actual gate helper controls production admission`, () => {
            const wf = workflow(name);
            expect(wf.on.workflow_dispatch.inputs.deploy_production).toMatchObject({ type: 'boolean', default: false });
            for (const jobName of jobs) {
                const job = wf.jobs[jobName];
                expect(condition(job.if, false)).toBe(false);
                expect(condition(job.if, undefined)).toBe(false);
                expect(condition(job.if, true, 'false')).toBe(false);
                expect(job.if).toContain(`needs.${gate}.outputs.allowed == 'true'`);
            }
            expect(wf.jobs[gate].steps.some((step) => step.run === 'node scripts/production-release-policy.mjs authorize')).toBe(true);
            expect(wf.jobs[gate].environment).toBeUndefined();
            expect(wf.jobs[gate].outputs.allowed).toBe('${{ steps.policy.outputs.allowed }}');
        });
    }
    it('main push cannot call the production backend; reusable receiver defaults off independently', () => {
        const caller = workflow('deploy-supabase-edge-release');
        expect(condition(caller.jobs['deploy-reviewed-edge-release'].if, true)).toBe(false);
        expect(caller.jobs['deploy-reviewed-edge-release'].with.deploy_production).toBe(false);
        expect(workflow('deploy-supabase-migrations').on.workflow_call.inputs.deploy_production.default).toBe(false);
    });
    it.each(['frontend', 'edge-functions'])('qualified deliberate %s route remains usable with exact confirmation', (operation) => {
        const wf = workflow('production-release');
        const selected = operation === 'frontend' ? 'release-frontend' : 'release-edge';
        const other = operation === 'frontend' ? 'release-edge' : 'release-frontend';
        expect(condition(wf.jobs[selected].if, true, 'true', operation)).toBe(true);
        expect(condition(wf.jobs[other].if, true, 'true', operation)).toBe(false);
        const script = wf.jobs['validate-release'].steps[0].run;
        const run = (confirm) => spawnSync('bash', ['-c', script], {
            env: { PATH: '/usr/bin:/bin', OPERATION: operation, EXPECTED_HEAD_SHA: SHA, CONFIRM: confirm },
            encoding: 'utf8', timeout: 3000,
        });
        expect(run(`RELEASE ${operation} AT ${SHA}`).status).toBe(0);
        expect(run(`RELEASE ${operation} AT ${OTHER}`).status).not.toBe(0);
        expect(run('').status).not.toBe(0);
    });
    it('deliberate frontend upload serializes with direct backend/migration workflows', () => {
        const release = workflow('production-release');
        expect(release.jobs['release-frontend'].concurrency).toEqual(workflow('deploy-supabase-migrations').concurrency);
        expect(release.jobs['release-frontend'].concurrency).toEqual(workflow('apply-exact-allowlisted-migration').concurrency);
    });
    it('ordinary main merges do not start live canaries; scheduled health remains bound to served SHA', () => {
        const wf = workflow('canary');
        expect(wf.on.push).toBeUndefined();
        expect(wf.on.schedule).toHaveLength(2);
        expect(wf.jobs['release-binding'].steps.find((step) => step.id === 'served').env.EXPECTED_RELEASE_SHA).toBe('${{ vars.PRODUCTION_RELEASE_SHA }}');
        for (const name of ['migration-readiness', 'canary-check']) {
            expect(wf.jobs[name].needs).toContain('release-binding');
            expect(wf.jobs[name].steps.find((step) => step.uses === 'actions/checkout@v6').with.ref).toBe('${{ needs.release-binding.outputs.release_sha }}');
        }
        expect(wf.jobs['canary-check'].steps.find((step) => step.name === 'Run Smoke Test (active-trial product path)').env.EXPECTED_RELEASE_SHA)
            .toBe('${{ needs.release-binding.outputs.release_sha }}');
    });
});

describe('scheduled health and release receipts cannot borrow unserved main identity', () => {
    it.each([undefined, '', 'main', 'a'.repeat(39)])('missing binding %s holds before HTTP', async (sha) => {
        const fetcher = vi.fn();
        expect((await verifyServedRelease(sha, fetcher)).allowed).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('matches actual canonical HTML, with redirect refusal and timeout', async () => {
        const fetcher = vi.fn(async () => new Response(`<script>window.__APP_RELEASE__="${SHA}";</script>`));
        expect(await verifyServedRelease(SHA, fetcher)).toEqual({ allowed: true, state: 'SERVED', releaseSha: SHA });
        expect(fetcher.mock.calls[0][0]).toBe('https://speaksharp-public.vercel.app/');
        expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
    });
    it.each([OTHER, null])('stale/missing served identity %s is HOLD', async (served) => {
        expect((await verifyServedRelease(SHA, async () => new Response(`window.__APP_RELEASE__="${served}";`))).allowed).toBe(false);
    });
    it('HTTP denial is HOLD, never product PASS', async () => {
        expect((await verifyServedRelease(SHA, async () => new Response('private', { status: 403 }))).allowed).toBe(false);
    });
    it('conflicting release markers cannot qualify even if the first one matches', async () => {
        expect((await verifyServedRelease(SHA, async () => new Response(`window.__APP_RELEASE__="${SHA}";window.__APP_RELEASE__="${OTHER}";`))).allowed).toBe(false);
    });
    it('oversized HTML is cancelled and held', async () => {
        const cancel = vi.fn();
        const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel });
        expect((await verifyServedRelease(SHA, async () => new Response(body))).allowed).toBe(false);
        expect(cancel).toHaveBeenCalled();
    });
    it('a valid intent by itself never implies qualification', () => {
        expect(releaseIntent(intent)).toEqual({ allowed: true, state: 'INTENT' });
    });
});
