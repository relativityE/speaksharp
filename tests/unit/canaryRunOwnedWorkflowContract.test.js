// @vitest-environment node
/** #1826 workflow contract: where the canary's production write may happen, and where it may not. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';

const wf = YAML.parse(readFileSync('.github/workflows/canary.yml', 'utf8'));
const job = wf.jobs['canary-check'];
const steps = job.steps;
const idx = (name) => steps.findIndex((s) => s.name === name);
const step = (name) => steps[idx(name)];
const CREATE = 'Create run-owned trial account (active-trial)';
const VERIFY = 'Verify run-owned trial account (active-trial)';
const SMOKE = 'Run Smoke Test (active-trial product path)';
const DELETE = 'Delete run-owned trial account (active-trial)';
const SWEEP = 'Sweep run-owned orphans (hygiene)';
const CEILING = 'Canary Account Ceiling (hygiene)';
const runOwned = (s) => String(s.run ?? '').includes('canary-run-owned');

describe('canary run-owned trial account wiring (#1826)', () => {
    it('runs create → verify → smoke → delete → sweep → ceiling, in that order', () => {
        const order = [CREATE, VERIFY, SMOKE, DELETE, SWEEP, CEILING].map(idx);
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
    it('the run-owned commands are exactly setup, cleanup and sweep, each in its own step, active-trial lane only', () => {
        expect(step(CREATE).run).toBe('pnpm exec tsx .canary-tooling/scripts/canary-run-owned.ts setup');
        expect(step(DELETE).run).toBe('pnpm exec tsx .canary-tooling/scripts/canary-run-owned.ts cleanup');
        expect(step(SWEEP).run).toBe('pnpm exec tsx .canary-tooling/scripts/canary-run-owned.ts sweep');
        expect(steps.filter(runOwned).map((s) => s.name)).toEqual([CREATE, DELETE, SWEEP]);
        expect(step(CREATE).if).toBe("matrix.lane == 'active-trial'");
    });
    it('the tooling comes from the WORKFLOW source while the product checkout stays on the served release (Codex P1 on 1a572919)', () => {
        const TOOLING = 'Checkout run-owned account tooling (workflow source)';
        const product = steps.find((s) => s.name === 'Checkout code');
        expect(product.with.ref).toBe('${{ needs.release-binding.outputs.release_sha }}');
        const tooling = step(TOOLING);
        expect(tooling.with).toMatchObject({ ref: '${{ github.sha }}', path: '.canary-tooling', 'persist-credentials': false, 'sparse-checkout-cone-mode': false });
        expect(tooling.with['sparse-checkout'].trim().split('\n').map((l) => l.trim())).toEqual(['scripts/canary-run-owned.ts', 'scripts/lib', 'tests/live/helpers']);
        expect(tooling.if).toBe("matrix.lane == 'active-trial'");
        // before every step that runs the tooling, after the workspace install it resolves packages from
        expect(idx(TOOLING)).toBeGreaterThan(idx('Setup Environment'));
        expect(idx(TOOLING)).toBeLessThan(idx(CREATE));
        for (const s of steps.filter(runOwned)) expect(String(s.run)).toMatch(/^pnpm exec tsx \.canary-tooling\/scripts\/canary-run-owned\.ts (setup|cleanup|sweep)$/);
    });
    it('delete and sweep ALWAYS run for the active-trial lane, whatever failed before them', () => {
        expect(step(DELETE).if).toBe("always() && matrix.lane == 'active-trial'");
        expect(step(SWEEP).if).toBe("always() && matrix.lane == 'active-trial'");
        expect(step(DELETE)['continue-on-error']).toBeUndefined();
        expect(step(SWEEP)['continue-on-error']).toBeUndefined();
    });
    it('the service-role key reaches ONLY create, delete, sweep and the existing ceiling step', () => {
        const withKey = steps.filter((s) => JSON.stringify(s.env ?? {}).includes('SUPABASE_SERVICE_ROLE_KEY')).map((s) => s.name);
        expect(withKey).toEqual([CREATE, DELETE, SWEEP, CEILING]);
    });
    it('verify and smoke use the run-owned credentials from $GITHUB_ENV: no step-level email/password override, no service role', () => {
        for (const name of [VERIFY, SMOKE]) {
            const env = step(name).env ?? {};
            for (const key of ['CANARY_EMAIL', 'CANARY_LANE_PASSWORD', 'SUPABASE_SERVICE_ROLE_KEY']) expect(env).not.toHaveProperty(key);
        }
        expect(step(VERIFY).env.SUPABASE_ANON_KEY).toBe('${{ secrets.SUPABASE_ANON_KEY }}');
    });
    it('only the sweep gets a GitHub token, and the job grants just contents:read and actions:read', () => {
        expect(steps.filter((s) => JSON.stringify(s.env ?? {}).includes('github.token')).map((s) => s.name)).toEqual([SWEEP]);
        expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
    });
    it('the billing-qualification lane gets no run-owned account step and no service role', () => {
        const billing = steps.filter((s) => String(s.if ?? '').includes("matrix.lane == 'billing-qualification'"));
        expect(billing.length).toBeGreaterThan(0);
        for (const s of billing) {
            expect(runOwned(s)).toBe(false);
            expect(JSON.stringify(s.env ?? {})).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
        }
    });
    it('the create step gets only what it needs: the URL, the key, and the trial identity (for its domain)', () => {
        expect(Object.keys(step(CREATE).env).sort()).toEqual(['CANARY_TRIAL_EMAIL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
        expect(Object.keys(step(DELETE).env).sort()).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
    });
});
