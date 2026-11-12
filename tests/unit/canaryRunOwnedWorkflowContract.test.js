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
const SMOKE = 'Run Smoke Test (active-trial product path, run-owned account)';
const LEGACY_PROVISION = 'Provision Canary User (active-trial)';
const LEGACY_SMOKE = 'Run Smoke Test (active-trial product path)';
const ON = "vars.CANARY_RUN_OWNED_TRIAL == 'enabled'";
const OFF = "vars.CANARY_RUN_OWNED_TRIAL != 'enabled'";
const DELETE = 'Delete run-owned trial account (active-trial)';
const SWEEP = 'Sweep run-owned orphans (hygiene)';
const CEILING = 'Canary Account Ceiling (hygiene)';
/** main's active-trial steps immediately before #1826, verbatim (canary.yml at 6f675875). */
const MAIN_LEGACY_ACTIVE_TRIAL_STEPS = "      # \u2500\u2500 Routine active-trial lane: the COMPLETE Pro product path through a genuine, server-active 30-day\n      #    trial (its effective tier is already 'pro'). Read-only sign-in; never mutates or charges. \u2500\u2500\n      - name: Provision Canary User (active-trial)\n        if: matrix.lane == 'active-trial'\n        env:\n          SUPABASE_URL: ${{ vars.SUPABASE_URL }}\n          # READ-ONLY canary: the PUBLIC anon key is the ONLY credential. No service-role key is injected \u2014\n          # the canary cannot create an account, reset a password, or grant/extend a trial. Any sign-in or\n          # verification failure fails closed.\n          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}\n          CANARY_LANE_PASSWORD: ${{ secrets.CANARY_TRIAL_PASSWORD }}\n          CANARY_EMAIL: ${{ vars.CANARY_TRIAL_EMAIL }}\n          CANARY_EXPECTED_ACCESS: active-trial\n          CANARY_MAX: '2'\n          CANARY_ENFORCE: fail\n        run: node scripts/provision-canary.mjs\n\n      - name: Run Smoke Test (active-trial product path)\n        if: matrix.lane == 'active-trial'\n        env:\n          VITE_TEST_MODE: \"true\"\n          VITE_USE_LIVE_DB: \"true\"\n          CANARY_LANE_PASSWORD: ${{ secrets.CANARY_TRIAL_PASSWORD }}\n          CANARY_EMAIL: ${{ vars.CANARY_TRIAL_EMAIL }}\n          CANARY_EXPECTED_ACCESS: active-trial\n          BASE_URL: https://speaksharp-public.vercel.app/\n          # A later main merge is not a deployment. Test the verified served release, not github.sha.\n          EXPECTED_RELEASE_SHA: ${{ needs.release-binding.outputs.release_sha }}\n        run: pnpm test:deploy:prod\n";
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
        expect(step(CREATE).if).toBe(`matrix.lane == 'active-trial' && ${ON}`);
    });
    it('the tooling comes from the WORKFLOW source while the product checkout stays on the served release (Codex P1 on 1a572919)', () => {
        const TOOLING = 'Checkout run-owned account tooling (workflow source)';
        const product = steps.find((s) => s.name === 'Checkout code');
        expect(product.with.ref).toBe('${{ needs.release-binding.outputs.release_sha }}');
        const tooling = step(TOOLING);
        expect(tooling.with).toMatchObject({ ref: '${{ github.sha }}', path: '.canary-tooling', 'persist-credentials': false, 'sparse-checkout-cone-mode': false });
        expect(tooling.with['sparse-checkout'].trim().split('\n').map((l) => l.trim())).toEqual(['scripts/canary-run-owned.ts', 'scripts/lib', 'tests/live/helpers']);
        expect(tooling.if).toBe(`matrix.lane == 'active-trial' && ${ON}`);
        // before every step that runs the tooling, after the workspace install it resolves packages from
        expect(idx(TOOLING)).toBeGreaterThan(idx('Setup Environment'));
        expect(idx(TOOLING)).toBeLessThan(idx(CREATE));
        for (const s of steps.filter(runOwned)) expect(String(s.run)).toMatch(/^pnpm exec tsx \.canary-tooling\/scripts\/canary-run-owned\.ts (setup|cleanup|sweep)$/);
    });
    it('ACTIVATION GATE (default off): account creation, the run-owned verify and smoke run ONLY when the gate is enabled (Sam on f2d50be3)', () => {
        for (const name of [CREATE, VERIFY, SMOKE]) expect(step(name).if).toBe(`matrix.lane == 'active-trial' && ${ON}`);
        // Nothing else in the job can create: the only step running `setup` is the gated one.
        expect(steps.filter((s) => String(s.run ?? '').includes('canary-run-owned.ts setup')).map((s) => s.name)).toEqual([CREATE]);
    });
    it('with the gate off, the active-trial lane runs exactly main\'s pre-#1826 read-only steps (only their `if` gains the OFF clause)', () => {
        for (const name of [LEGACY_PROVISION, LEGACY_SMOKE]) expect(step(name).if).toBe(`matrix.lane == 'active-trial' && ${OFF}`);
        const raw = readFileSync('.github/workflows/canary.yml', 'utf8');
        const legacy = MAIN_LEGACY_ACTIVE_TRIAL_STEPS;
        expect(raw).toContain(legacy.replaceAll("if: matrix.lane == 'active-trial'\n", `if: matrix.lane == 'active-trial' && ${OFF}\n`));
        expect(step(LEGACY_PROVISION).env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    });
    it('the two paths are complementary: for any gate value exactly one provision path and one smoke runs', () => {
        const runs = (cond, gate) => cond.split(' && ').every((c) => c === "matrix.lane == 'active-trial'"
            || (c === ON ? gate === 'enabled' : c === OFF ? gate !== 'enabled' : (() => { throw new Error(`unexpected condition ${c}`); })()));
        for (const gate of [undefined, '', 'enabled', 'Enabled', 'true', 'disabled']) {
            const smokes = [SMOKE, LEGACY_SMOKE].filter((n) => runs(step(n).if, gate));
            const provision = [CREATE, LEGACY_PROVISION].filter((n) => runs(step(n).if, gate));
            expect({ gate, smokes: smokes.length, provisions: provision.length, creates: provision[0] === CREATE })
                .toEqual({ gate, smokes: 1, provisions: 1, creates: gate === 'enabled' });
        }
    });
    it('with the gate OFF no destructive or tooling step is reachable: create, delete, sweep and the tooling checkout are all gated (Sam on 79a4b7ee)', () => {
        for (const name of [CREATE, DELETE, SWEEP, 'Checkout run-owned account tooling (workflow source)']) expect(String(step(name).if)).toContain(ON);
        // Every step that runs the tooling (setup, cleanup, sweep) carries the ON clause.
        for (const s of steps.filter(runOwned)) expect(String(s.if)).toContain(ON);
        // With the gate off, every service-role step left is the pre-existing ceiling check alone.
        const gateOn = (s) => String(s.if ?? '').includes(ON);
        const reachableWithKey = steps.filter((s) => !gateOn(s) && JSON.stringify(s.env ?? {}).includes('SUPABASE_SERVICE_ROLE_KEY')).map((s) => s.name);
        expect(reachableWithKey).toEqual([CEILING]);
    });
    it('when enabled, delete and sweep ALWAYS run for the active-trial lane, whatever failed before them', () => {
        expect(step(DELETE).if).toBe(`always() && matrix.lane == 'active-trial' && ${ON}`);
        expect(step(SWEEP).if).toBe(`always() && matrix.lane == 'active-trial' && ${ON}`);
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
