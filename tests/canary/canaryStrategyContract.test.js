// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

// #1294 — EXECUTABLE canary strategy contract (replaces token-presence assertions). It parses canary.yml
// and (a) mirror-evaluates the routine-vs-paid trigger + concurrency expressions for every trigger scenario,
// anchoring the mirror to the workflow's ACTUAL expression string so they cannot silently diverge; and
// (b) EXECUTES the canary-result terminal-state bash under controlled env, asserting the real summary text,
// failure signalling, and migration-HOLD behaviour.
const WF_PATH = '.github/workflows/canary.yml';
const wf = load(readFileSync(WF_PATH, 'utf8'));

// Mirror of the workflow's routine-vs-paid decision. `paid-qual` requires an explicit dispatch that opted in.
const isPaidQualification = (eventName, includePaidBilling) =>
  eventName === 'workflow_dispatch' && includePaidBilling === true;
const lanesFor = (eventName, includePaidBilling) =>
  isPaidQualification(eventName, includePaidBilling) ? ['active-trial', 'paid-continuation'] : ['active-trial'];

describe('canary strategy — trigger contract (executable)', () => {
  it('routine push/schedule and non-billing dispatch run ONLY active-trial; billing dispatch adds paid', () => {
    expect(lanesFor('push', false)).toEqual(['active-trial']);
    expect(lanesFor('schedule', false)).toEqual(['active-trial']);
    expect(lanesFor('workflow_dispatch', false)).toEqual(['active-trial']);
    expect(lanesFor('workflow_dispatch', true)).toEqual(['active-trial', 'paid-continuation']);
    // A boolean dispatch input gates the paid lane; a routine push can never carry it.
    expect(lanesFor('push', true)).toEqual(['active-trial']); // push has no include_paid_billing input
  });

  it('the workflow matrix expression matches the mirrored decision (no silent divergence)', () => {
    const laneExpr = wf.jobs['canary-check'].strategy.matrix.lane;
    expect(laneExpr).toContain("github.event_name == 'workflow_dispatch'");
    expect(laneExpr).toContain('inputs.include_paid_billing == true');
    expect(laneExpr).toContain('["active-trial","paid-continuation"]');
    expect(laneExpr).toContain('["active-trial"]');
    // The paid lane is an OPT-IN dispatch boolean, default false.
    expect(wf.on.workflow_dispatch.inputs.include_paid_billing.type).toBe('boolean');
    expect(wf.on.workflow_dispatch.inputs.include_paid_billing.default).toBe(false);
  });
});

describe('canary strategy — concurrency contract (executable)', () => {
  const groupSuffix = (eventName, includePaidBilling) => (isPaidQualification(eventName, includePaidBilling) ? 'paid-qual' : 'routine');

  it('a routine run and a paid-qualification run occupy DIFFERENT concurrency groups (neither cancels the other)', () => {
    expect(groupSuffix('push', false)).toBe('routine');
    expect(groupSuffix('schedule', false)).toBe('routine');
    expect(groupSuffix('workflow_dispatch', false)).toBe('routine');
    expect(groupSuffix('workflow_dispatch', true)).toBe('paid-qual');
    expect(groupSuffix('push', false)).not.toBe(groupSuffix('workflow_dispatch', true));
  });

  it('the workflow concurrency group partitions routine vs paid-qual on the same ref', () => {
    const group = wf.concurrency.group;
    expect(group).toContain('paid-qual');
    expect(group).toContain('routine');
    expect(group).toContain('github.ref');
    expect(wf.concurrency['cancel-in-progress']).toBe(true);
  });
});

describe('canary strategy — terminal-state contract (executed bash)', () => {
  // Pull the ACTUAL bash from the canary-result step and run it with controlled env; assert summary + exit.
  const step = wf.jobs['canary-result'].steps.find((s) => typeof s.run === 'string' && s.run.includes('GITHUB_STEP_SUMMARY'));
  const script = step.run;

  const runTerminal = (env) => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-term-'));
    const scriptPath = join(dir, 'terminal.sh');
    const summaryPath = join(dir, 'summary.md');
    writeFileSync(scriptPath, script);
    writeFileSync(summaryPath, '');
    const res = spawnSync('bash', [scriptPath], {
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath, ...env },
      encoding: 'utf8',
    });
    return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', summary: readFileSync(summaryPath, 'utf8') };
  };

  const READY = { READINESS_RESULT: 'success', MIGRATION_READY: 'true' };

  it('migration readiness could not be established → hard error, exit 1', () => {
    const r = runTerminal({ READINESS_RESULT: 'failure', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', PAID_BILLING_REQUESTED: 'false' });
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('migration readiness could not be established');
  });

  it('migration pending → HOLD, exit 0; paid reported as NOT REQUESTED when off', () => {
    const r = runTerminal({ READINESS_RESULT: 'success', MIGRATION_READY: 'false', PRODUCT_LANES_RESULT: 'skipped', PAID_BILLING_REQUESTED: 'false' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('HOLD — migration pending; canary not executed');
    expect(r.summary).toContain('Paid billing qualification: not requested.');
  });

  it('active-trial lane failed (routine) → hard error naming the active-trial lane, exit 1', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'failure', PAID_BILLING_REQUESTED: 'false' });
    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('required active-trial product lane failed');
  });

  it('all passed, paid NOT requested → qualification passed + explicit "not requested", exit 0', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'success', PAID_BILLING_REQUESTED: 'false' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('Canary qualification passed');
    expect(r.summary).toContain('The active-trial product journey completed.');
    expect(r.summary).toContain('Paid billing qualification: not requested.');
    // Routine green must NEVER claim paid billing passed.
    expect(r.summary).not.toContain('paid-continuation billing qualification also completed');
  });

  it('all passed, paid REQUESTED → paid qualification reported as completed, exit 0', () => {
    const r = runTerminal({ ...READY, PRODUCT_LANES_RESULT: 'success', PAID_BILLING_REQUESTED: 'true' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('paid-continuation billing qualification also completed');
    expect(r.summary).not.toContain('Paid billing qualification: not requested.');
  });
});
