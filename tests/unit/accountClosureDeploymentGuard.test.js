// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { parse } from 'yaml';
import { invalidateAccountClosureBeforeDeployment } from '../../scripts/lib/accountClosureDeploymentGuard.mjs';

const input = { url: 'https://fixture-project.supabase.co', projectId: 'fixture-project', serviceKey: 'synthetic-private-key', releaseSha: 'a'.repeat(40) };
function fixture(values = ['"7"', '8', '"8"']) {
    const fetcher = vi.fn(async () => new Response(values.shift()));
    return { fetcher, run: () => invalidateAccountClosureBeforeDeployment(input, fetcher) };
}
describe('deployment invalidates deletion authority before any worker change', () => {
    it('reads current generation, CAS invalidates exactly once, then confirms it without enabling', async () => {
        const { run, fetcher } = fixture();
        expect(await run()).toEqual({ status: 'INVALIDATED', generation: '8', activationAuthorized: false });
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(fetcher.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual([
            'inspect_account_closure_drain_generation', 'invalidate_account_closure_drain_attestations', 'inspect_account_closure_drain_generation']);
        for (const [url, options] of fetcher.mock.calls) {
            expect(url.startsWith(`${input.url}/rest/v1/rpc/`)).toBe(true);
            expect(options).toMatchObject({ method: 'POST', redirect: 'error' }); expect(options.signal).toBeDefined();
        }
        expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ p_expected_generation: '7',
            p_reason: 'deployment_changed', p_evidence_digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    });
    it('preserves generation values larger than the JavaScript safe integer range', async () => {
        const { run } = fixture(['"9007199254740992"', '9007199254740993', '"9007199254740993"']);
        expect(await run()).toMatchObject({ status: 'INVALIDATED', generation: '9007199254740993' });
    });
    it.each(['https://foreign.example.test', 'https://other.supabase.co', 'https://fixture-project.supabase.co/path',
        'https://user:secret@fixture-project.supabase.co', 'https://fixture-project.supabase.co?token=secret', 'http://fixture-project.supabase.co'])('refuses unsafe target before forwarding its service credential: %s', async (url) => {
        const { fetcher } = fixture();
        expect(await invalidateAccountClosureBeforeDeployment({ ...input, url }, fetcher)).toMatchObject({ status: 'HOLD', mutationOutcome: 'not_attempted' });
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('canonicalizes the verified root URL without allowing a path', async () => {
        const { fetcher } = fixture();
        expect((await invalidateAccountClosureBeforeDeployment({ ...input, url: `${input.url}/` }, fetcher)).status).toBe('INVALIDATED');
    });
    it('read denial stops before mutation without echoing a private response', async () => {
        const { run, fetcher } = fixture(); fetcher.mockResolvedValue(new Response('private-error synthetic-private-key', { status: 403 }));
        const result = await run(); expect(result).toMatchObject({ status: 'HOLD', mutationOutcome: 'not_attempted' });
        expect(JSON.stringify(result)).not.toMatch(/private|key/); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('lost invalidation acknowledgment stays unknown without retry or worker deployment', async () => {
        const { run, fetcher } = fixture();
        fetcher.mockResolvedValueOnce(new Response('"7"')).mockRejectedValueOnce(new Error('lost private response'));
        expect(await run()).toMatchObject({ status: 'HOLD', mutationOutcome: 'unknown' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it.each([['"7"', '9'], ['"7"', '8', '"9"'], ['"7"', '{}'], ['"9223372036854775807"']])('wrong acknowledgment/readback or overflow cannot authorize deployment: %j', async (...values) => {
        const { run } = fixture(values);
        expect((await run()).status).toBe('HOLD');
    });
    it('does not consume an unbounded successful response body', async () => {
        const { run } = fixture(['x'.repeat(257)]);
        expect(await run()).toMatchObject({ status: 'HOLD', mutationOutcome: 'not_attempted' });
    });
    it('one invalidation precedes every backend mutation job and both jobs require its success', () => {
        const workflow = parse(readFileSync('.github/workflows/deploy-supabase-migrations.yml', 'utf8'));
        const guardName = 'invalidate-account-closure-authority';
        const guard = workflow.jobs[guardName];
        expect(guard).toBeDefined();
        expect(guard.needs).toEqual(['validate-edge-configuration', 'verify-t2-database-prerequisites']);
        expect(guard.if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
        expect(guard.environment).toBe('production-db');
        expect(guard.if).toContain("inputs.deploy_production == true");
        expect(guard.if).toContain("needs.validate-edge-configuration.outputs.allowed == 'true'");
        const invalidations = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
            .filter((step) => step.run === 'node scripts/account-closure-invalidate.mjs');
        expect(invalidations).toHaveLength(1);
        expect(invalidations[0]['continue-on-error']).toBeUndefined();
        expect(invalidations[0].env).toMatchObject({ SUPABASE_URL: '${{ vars.SUPABASE_URL }}',
            SUPABASE_PROJECT_ID: '${{ vars.SUPABASE_PROJECT_ID }}', SUPABASE_SERVICE_ROLE_KEY: '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}' });
        for (const name of ['deploy-production-db', 'deploy-edge-functions']) {
            expect(workflow.jobs[name].needs).toContain(guardName);
            expect(workflow.jobs[name].if).toContain(`needs.${guardName}.result == 'success'`);
            expect(workflow.jobs[name]['continue-on-error']).toBeUndefined();
        }
        expect(guard.steps.some((step) => step.run === 'node scripts/account-closure-invalidate.mjs')).toBe(true);
    });
    it.each(['edge-functions', 'migrations', 'migrations-and-edge-functions', 'secrets', 'all'])('validates %s and its authority BEFORE the mutation guard', (operation) => {
        const workflow = parse(readFileSync('.github/workflows/deploy-supabase-migrations.yml', 'utf8'));
        const resolve = workflow.jobs['validate-edge-configuration'].steps.find((step) => step.id === 'resolve');
        expect(resolve.env.CONFIRM_INPUT).toBe('${{ inputs.confirm }}');
        const directory = mkdtempSync(join(tmpdir(), 'closure-deploy-contract-'));
        function run(confirm) {
            return spawnSync('bash', ['-c', resolve.run], { env: { PATH: '/usr/bin:/bin',
                EVENT_NAME: 'workflow_dispatch', OPERATION: operation, CONFIRM_INPUT: confirm,
                CALLED_DEPLOY_EDGE: 'false', GITHUB_OUTPUT: join(directory, 'output') }, encoding: 'utf8', timeout: 3000 });
        }
        try {
            expect(run('DEPLOY').status).toBe(0);
            const edge = ['edge-functions', 'migrations-and-edge-functions', 'all'].includes(operation);
            expect(readFileSync(join(directory, 'output'), 'utf8')).toContain(`deploy_edge_functions=${edge}`);
            expect(run('').status).toBe(operation === 'edge-functions' ? 0 : 1);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });
    it('unconfigured actual command exits nonzero with bounded HOLD and no network', () => {
        const result = spawnSync(process.execPath, ['scripts/account-closure-invalidate.mjs'], { env: {}, encoding: 'utf8', timeout: 5000 });
        expect(result.status).toBe(1); expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toEqual({ status: 'HOLD', mutationOutcome: 'not_attempted', activationAuthorized: false });
    });
});
