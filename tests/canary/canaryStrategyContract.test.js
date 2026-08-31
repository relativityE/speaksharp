// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

// #1294 — EXECUTABLE canary strategy contract (replaces token-presence assertions). Parses canary.yml and
// (a) mirror-evaluates the AUTOMATED daily-vs-weekly cadence + concurrency for every trigger scenario,
// anchored to the workflow's actual expressions so they cannot silently diverge; (b) EXECUTES the
// canary-result terminal bash to assert the real summary/failure/migration-HOLD behaviour; and (c) asserts
// the migration/held-activation fail-closed and the billing lane's test-mode wiring structurally.
const WF_PATH = '.github/workflows/canary.yml';
const wf = load(readFileSync(WF_PATH, 'utf8'));

const DAILY = '0 5 * * *';
const WEEKLY = '0 6 * * 1';
// Mirror of the workflow's cadence decision: ONLY the WEEKLY schedule runs the billing qualification. There
// is NO manual route — no dispatch input can select or count as the paid qualification. Everything else
// (daily schedule, push, dispatch diagnostic) is active-trial only.
const isBillingCadence = (ctx) => ctx.schedule === WEEKLY;
const lanesFor = (ctx) => (isBillingCadence(ctx) ? ['active-trial', 'billing-qualification'] : ['active-trial']);
const groupSuffix = (ctx) => (isBillingCadence(ctx) ? 'billing' : 'active-trial');

describe('canary cadence — automated daily active-trial + weekly billing (executable)', () => {
  it('DAILY schedule selects active-trial only', () => {
    expect(lanesFor({ eventName: 'schedule', schedule: DAILY })).toEqual(['active-trial']);
  });

  it('WEEKLY schedule selects active-trial + the Stripe test-mode/test-clock billing qualification — automatically', () => {
    expect(lanesFor({ eventName: 'schedule', schedule: WEEKLY })).toEqual(['active-trial', 'billing-qualification']);
  });

  it('NO manual dispatch: the weekly SCHEDULE alone runs billing, and NO dispatch can select it', () => {
    // Weekly schedule runs it automatically…
    expect(lanesFor({ eventName: 'schedule', schedule: WEEKLY })).toContain('billing-qualification');
    // …and there is NO dispatch route to billing (push and any dispatch are active-trial only).
    expect(lanesFor({ eventName: 'push' })).toEqual(['active-trial']);
    expect(lanesFor({ eventName: 'workflow_dispatch' })).toEqual(['active-trial']);
    // The manual billing input is GONE entirely.
    const inputs = wf.on.workflow_dispatch?.inputs ?? {};
    expect(inputs.include_paid_billing).toBeUndefined();
    const laneExpr = wf.jobs['canary-check'].strategy.matrix.lane;
    expect(laneExpr).not.toContain('include_paid_billing');
    expect(wf.concurrency.group).not.toContain('include_paid_billing');
  });

  it('the workflow declares BOTH the daily and weekly schedules, and the matrix mirrors the cadence', () => {
    const crons = wf.on.schedule.map((s) => s.cron);
    expect(crons).toContain(DAILY);
    expect(crons).toContain(WEEKLY);
    const laneExpr = wf.jobs['canary-check'].strategy.matrix.lane;
    expect(laneExpr).toContain(`github.event.schedule == '${WEEKLY}'`);
    expect(laneExpr).toContain('["active-trial","billing-qualification"]');
    expect(laneExpr).toContain('["active-trial"]');
  });
});

describe('canary concurrency — daily and weekly cadences cannot cancel each other (executable)', () => {
  it('daily active-trial and weekly billing occupy DIFFERENT concurrency groups', () => {
    expect(groupSuffix({ eventName: 'schedule', schedule: DAILY })).toBe('active-trial');
    expect(groupSuffix({ eventName: 'schedule', schedule: WEEKLY })).toBe('billing');
    expect(groupSuffix({ eventName: 'schedule', schedule: DAILY })).not.toBe(groupSuffix({ eventName: 'schedule', schedule: WEEKLY }));
  });

  it('the workflow concurrency group partitions the two cadences on the same ref', () => {
    const group = wf.concurrency.group;
    expect(group).toContain(`github.event.schedule == '${WEEKLY}'`);
    expect(group).toContain('billing');
    expect(group).toContain('active-trial');
    expect(group).toContain('github.ref');
    expect(wf.concurrency['cancel-in-progress']).toBe(true);
  });
});

describe('canary billing lane — test-mode wiring (structural)', () => {
  const steps = wf.jobs['canary-check'].steps;
  const billingStep = steps.find((s) => s.if === "matrix.lane == 'billing-qualification'" && typeof s.run === 'string');

  it('the billing lane runs the guarded test-mode/test-clock runner and refuses a live key', () => {
    expect(billingStep, 'billing-qualification step exists').toBeTruthy();
    // The billing lane runs the Deno qualification (real handler + migrated PGlite), not the removed Node runner.
    expect(billingStep.run).toContain('scripts/billing-qualification/qualify.ts');
    expect(billingStep.run).toContain('deno run');
    expect(billingStep.run).not.toContain('paid-billing-qualification.mjs');
    expect(billingStep.run).toContain('sk_live_'); // explicit live-key refusal branch
    // It uses TEST-scoped Stripe secrets only.
    expect(billingStep.env.STRIPE_SECRET_KEY).toContain('STRIPE_TEST_SECRET_KEY');
  });

  it('the strict production paid verifier is preserved (not deleted) for a future live proof', () => {
    // The paid-continuation verifier remains in the library even though it is not a scheduled canary lane.
    const paidVerifier = readFileSync('scripts/lib/canaryProvision.mjs', 'utf8');
    expect(paidVerifier).toContain("lane !== 'paid-continuation'");
    expect(paidVerifier).toContain('paid canary missing customer/subscription identifiers');
  });
});

describe('canary migration/held-activation — fail-closed (structural)', () => {
  const readiness = wf.jobs['migration-readiness'].steps.find((s) => typeof s.run === 'string' && s.run.includes('activation-applied'));
  it('hard-fails when held activation migration 20260812042000 is applied', () => {
    expect(readiness.run).toContain('20260812042000');
    expect(readiness.run).toContain('activation-applied');
    expect(readiness.run).toContain('exit 1');
  });
});

describe('canary terminal-state — executed bash (summary / failure / migration-HOLD)', () => {
  const step = wf.jobs['canary-result'].steps.find((s) => typeof s.run === 'string' && s.run.includes('GITHUB_STEP_SUMMARY'));
  const script = step.run;

  const runTerminal = (env) => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-term-'));
    const scriptPath = join(dir, 'terminal.sh');
    const summaryPath = join(dir, 'summary.md');
    writeFileSync(scriptPath, script);
    writeFileSync(summaryPath, '');
    const res = spawnSync('bash', [scriptPath], { env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, ...env }, encoding: 'utf8' });
    return { code: res.status, out: (res.stdout ?? '') + (res.stderr ?? ''), summary: readFileSync(summaryPath, 'utf8') };
  };
  const READY = { READINESS_RESULT: 'success', MIGRATION_READY: 'true' };

  it('migration readiness unestablished → hard error, exit 1', () => {
    const r = runTerminal({ READINESS_RESULT: 'failure', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', BILLING_QUALIFICATION_RAN: 'false' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('migration readiness could not be established');
  });

  // CORRECTED CONTRACT, not a relaxed one. This case previously asserted `exit 0`, which is precisely why
  // the defect survived: a HOLD skips `canary-check` entirely, so the run concluded SUCCESS having executed
  // ZERO product qualification — indistinguishable, to anyone reading the badge, from a passing product
  // run. The test encoded the defect as correct behaviour. A HOLD is now NON-SUCCESS.
  it('migration pending → HOLD is NON-SUCCESS; zero product lanes ran', () => {
    const r = runTerminal({ READINESS_RESULT: 'success', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', BILLING_QUALIFICATION_RAN: 'false', PENDING_MIGRATIONS: '20260829120000' });
    expect(r.code).not.toBe(0);
    expect(r.summary).toContain('NO product qualification ran');
    expect(r.summary).toContain('Weekly billing qualification: not part of this run');
  });

  it('a HOLD names the pending migration(s), so the cause is not guesswork', () => {
    const r = runTerminal({ READINESS_RESULT: 'success', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', BILLING_QUALIFICATION_RAN: 'false', PENDING_MIGRATIONS: '20260829120000' });
    expect(r.summary).toContain('20260829120000');
  });

  it('a HOLD stays DISTINGUISHABLE from a product-lane failure', () => {
    // Both are non-success. Conflating them would send someone debugging a product regression that never
    // ran, so the distinction has to survive in the emitted text.
    const held = runTerminal({ READINESS_RESULT: 'success', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', BILLING_QUALIFICATION_RAN: 'false', PENDING_MIGRATIONS: 'x' });
    const failed = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'failure', BILLING_QUALIFICATION_RAN: 'false' });
    expect(held.out + held.summary).toContain('HELD');
    expect(failed.out).toContain('required daily active-trial product lane failed');
    expect(failed.out + failed.summary).not.toContain('CANARY HELD');
  });

  it('the readiness job publishes `pending`, and canary-check is still gated on readiness', () => {
    // The HOLD can only name its cause if readiness exports it; the HOLD only MEANS anything if the
    // product lanes are genuinely skipped when not ready.
    expect(wf.jobs['migration-readiness'].outputs).toHaveProperty('pending');
    expect(wf.jobs['canary-check'].if).toContain("needs.migration-readiness.outputs.ready == 'true'");
  });

  it('lane failure (daily) → hard error naming the daily active-trial lane, exit 1', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'failure', BILLING_QUALIFICATION_RAN: 'false' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('required daily active-trial product lane failed');
  });

  it('daily passed (no billing) → distinguishes active-trial from weekly billing; never claims billing ran', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'success', BILLING_QUALIFICATION_RAN: 'false' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('Daily active-trial product journey: completed.');
    expect(r.summary).toContain('Weekly billing qualification: not part of this run');
    expect(r.summary).not.toContain('billing qualification: completed');
  });

  it('weekly passed (billing ran) → reports the completed no-charge billing qualification, exit 0', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'success', BILLING_QUALIFICATION_RAN: 'true' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('billing qualification: completed (no live charge)');
    expect(r.summary).not.toContain('not part of this run');
  });
});
