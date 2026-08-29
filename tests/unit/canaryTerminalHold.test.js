import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

/**
 * Canary terminal truth: a HOLD must NOT conclude success.
 *
 * THE DEFECT. When a required migration is pending, `canary-check` is skipped by its `if:` and the terminal
 * `canary-result` job exited 0. The run therefore concluded SUCCESS having executed ZERO product
 * qualification — indistinguishable, to anyone reading the badge, from a passing product run. A warning
 * annotation does not fix that, because the run's CONCLUSION is what is consumed.
 */
const WF = resolve(__dirname, '../../.github/workflows/canary.yml');
const yaml = load(readFileSync(WF, 'utf8'));
const result = yaml.jobs['canary-result'];
const script = result.steps.find((s) => /truthful terminal state/i.test(s.name)).run;

/** Execute the terminal script body with a given environment; returns its exit code and output. */
const terminal = (env) => {
    try {
        return { code: 0, out: execFileSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '/dev/null', ...env } }) };
    } catch (e) { return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
};

const HELD = { READINESS_RESULT: 'success', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', BILLING_QUALIFICATION_RAN: 'false', PENDING_MIGRATIONS: '20260829120000' };
const PASS = { READINESS_RESULT: 'success', MIGRATION_READY: 'true', PRODUCT_LANES_RESULT: 'success', BILLING_QUALIFICATION_RAN: 'false' };

describe('a HOLD is NOT success', () => {
    it('required migration pending with zero product lanes run → NON-SUCCESS', () => {
        const r = terminal(HELD);
        expect(r.code).not.toBe(0);
        expect(r.out).toMatch(/CANARY HELD/);
        expect(r.out).toMatch(/zero product qualification/i);
    });

    it('the HOLD names the pending migration, so the cause is not guesswork', () => {
        expect(terminal(HELD).out).toMatch(/20260829120000|proves nothing/);
    });

    it('a HOLD is distinguishable from a product FAILURE, not merged into it', () => {
        // Both are non-success; conflating them would send someone debugging a product regression that
        // never ran. The distinction lives in the emitted text.
        const held = terminal(HELD).out;
        const failed = terminal({ ...PASS, PRODUCT_LANES_RESULT: 'failure' }).out;
        expect(held).toMatch(/HELD/);
        expect(failed).toMatch(/product lane .*failed|failed/i);
        expect(failed).not.toMatch(/CANARY HELD/);
    });
});

describe('the other two terminal states are unchanged', () => {
    it('product canary FAILED → non-success', () => {
        expect(terminal({ ...PASS, PRODUCT_LANES_RESULT: 'failure' }).code).not.toBe(0);
    });

    it('POSITIVE CONTROL: product canary PASSED → success', () => {
        const r = terminal(PASS);
        expect(r.code).toBe(0);
    });

    it('readiness itself failing → non-success', () => {
        expect(terminal({ ...HELD, READINESS_RESULT: 'failure' }).code).not.toBe(0);
    });
});

describe('the readiness job exposes what the terminal job needs', () => {
    it('publishes `pending` as a job output, so the HOLD can name its cause', () => {
        expect(yaml.jobs['migration-readiness'].outputs).toHaveProperty('pending');
    });

    it('canary-check is still gated on readiness — the HOLD really does skip the product lanes', () => {
        expect(yaml.jobs['canary-check'].if).toContain("needs.migration-readiness.outputs.ready == 'true'");
    });
});
