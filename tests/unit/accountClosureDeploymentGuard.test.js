// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
    it('workflow orders invalidation before deploy and stops on its failure', () => {
        const workflow = parse(readFileSync('.github/workflows/deploy-supabase-migrations.yml', 'utf8'));
        const steps = workflow.jobs['deploy-edge-functions'].steps;
        const guard = steps.findIndex((step) => step.run === 'node scripts/account-closure-invalidate.mjs');
        const deploy = steps.findIndex((step) => step.run?.includes('supabase functions deploy '));
        expect(guard).toBeGreaterThan(-1); expect(guard).toBeLessThan(deploy);
        expect(steps[guard]['continue-on-error']).toBeUndefined(); expect(steps[deploy].if).toBeUndefined();
        expect(steps[guard].env).toMatchObject({ SUPABASE_URL: '${{ vars.SUPABASE_URL }}', SUPABASE_SERVICE_ROLE_KEY: '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}' });
    });
    it('unconfigured actual command exits nonzero with bounded HOLD and no network', () => {
        const result = spawnSync(process.execPath, ['scripts/account-closure-invalidate.mjs'], { env: {}, encoding: 'utf8', timeout: 5000 });
        expect(result.status).toBe(1); expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toEqual({ status: 'HOLD', mutationOutcome: 'not_attempted', activationAuthorized: false });
    });
});
