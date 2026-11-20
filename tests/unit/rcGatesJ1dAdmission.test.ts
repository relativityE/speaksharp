// @vitest-environment node
// J1.d (Sam 1a, 16 Nov) runs only under a named-runner admission bound to the run, on the account J1.a creates in that run. These
// execute the rc-gates diagnostic step's own admission block (bash + jq) and check what it writes with the spec's own
// j1dRunnerAdmission, so the workflow and the spec cannot drift apart.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { J1D_ADMISSION_ENV, j1dRunnerAdmission } from '../live/helpers/rwtJ1dJourney';
import { deletionDomain, ownedPrefixOf } from '../live/helpers/rwtInterruptedRunRecovery';

/** J1.a's account under J1.d: exactly the run-owned shape interrupted-run recovery recognises. */
const OWNED_REF = (domain: string) => new RegExp(`^rwt-journey-open-mic-\\d{13}-4242@${domain.replace(/\./g, '\\.')}$`);

const workflowText = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
const workflow = parse(workflowText) as { on: { workflow_dispatch: { inputs: Record<string, { default?: string }> } };
  jobs: Record<string, { steps: { name?: string; run?: string; env?: Record<string, string> }[] }> };
const diagnostic = Object.values(workflow.jobs).flatMap(j => j.steps ?? [])
  .find(s => s.name === 'Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)');
const run = diagnostic?.run ?? '';
const block = run.slice(run.indexOf('# >>> J1D admission'), run.indexOf('# <<< J1D admission'));
const SPEC = 'tests/live/rwt-open-mic-first-session.live.spec.ts';

let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

function admit(env: Record<string, string>) {
  const temp = mkdtempSync(path.join(tmpdir(), 'j1d-admission-')); dirs.push(temp);
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${block}\necho "ADMISSION=\${${J1D_ADMISSION_ENV}:-}"`], { encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', RUNNER_TEMP: temp, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1', DIAGNOSTIC_DAST_SPEC: SPEC,
      LIVE_TEST_EMAIL_DOMAIN: 'rwt-tests.example.org', ...env } });
  const file = /ADMISSION=(.*)/.exec(r.stdout)?.[1] ?? '';
  return { status: r.status, stdout: r.stdout, file, files: readdirSync(temp) };
}

describe('rc-gates J1.d admission (diagnostic step)', () => {
  it('is wired: one closed input, empty by default, passed only to the diagnostic step, inside its run block', () => {
    expect(workflow.on.workflow_dispatch.inputs.rwt_j1d_leg?.default).toBe('');
    expect(diagnostic?.env?.RWT_J1D_LEG).toBe('${{ github.event.inputs.rwt_j1d_leg }}');
    expect(block.length).toBeGreaterThan(0);
    expect(run.indexOf('# <<< J1D admission')).toBeLessThan(run.indexOf('pnpm exec playwright test'));
    // The input, its one env binding, and the refusal message: no other step reads it.
    expect(workflowText.split('rwt_j1d_leg').length - 1).toBe(3);
    expect(workflowText.split('github.event.inputs.rwt_j1d_leg').length - 1).toBe(1);
  });

  it('writes nothing when the input is empty: J1.d stays NOT RUN', () => {
    const r = admit({ RWT_J1D_LEG: '' });
    expect(r.status).toBe(0);
    expect(r.file).toBe('');
    expect(r.files).toEqual([]);
  });

  it('J1D-ON-J1A with J1.a\'s spec writes the admission the spec accepts, bound to this run and attempt', () => {
    const r = admit({ RWT_J1D_LEG: 'J1D-ON-J1A', LIVE_TEST_EMAIL_DOMAIN: 'Test.Example.COM' });
    expect(r.status).toBe(0);
    const record = JSON.parse(readFileSync(r.file, 'utf8'));
    expect(record).toMatchObject({ suite: 'returning-signout-j1d', runId: '4242', runAttempt: '1', reusesLeg: 'J1.a' });
    expect(Object.keys(record).sort()).toEqual(['lookupRef', 'reusesLeg', 'runAttempt', 'runId', 'suite']);
    expect(record.lookupRef).toMatch(OWNED_REF('test.example.com'));
    // Interrupted-run recovery recognises J1.a's account, so an interrupted J1.a+J1.d run cannot orphan it.
    expect(ownedPrefixOf(record.lookupRef, 'test.example.com')).toBe('rwt-journey-');
    const read = (p: string) => readFileSync(p, 'utf8');
    expect(j1dRunnerAdmission({ [J1D_ADMISSION_ENV]: r.file, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1' }, read))
      .toEqual({ admitted: true, lookupRef: record.lookupRef });
    // The same record is refused under another attempt or run, and never carries an account-create attempt.
    expect(j1dRunnerAdmission({ [J1D_ADMISSION_ENV]: r.file, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '2' }, read).admitted).toBe(false);
    expect(j1dRunnerAdmission({ [J1D_ADMISSION_ENV]: r.file, GITHUB_RUN_ID: '9999', GITHUB_RUN_ATTEMPT: '1' }, read).admitted).toBe(false);
    expect('createAttempt' in record).toBe(false);
  });

  it('a rerun attempt gets its own record and account reference, never the first attempt\'s', () => {
    const first = JSON.parse(readFileSync(admit({ RWT_J1D_LEG: 'J1D-ON-J1A' }).file, 'utf8'));
    const r = admit({ RWT_J1D_LEG: 'J1D-ON-J1A', GITHUB_RUN_ATTEMPT: '3' });
    const record = JSON.parse(readFileSync(r.file, 'utf8'));
    expect(record.runAttempt).toBe('3');
    expect(record.lookupRef).toMatch(OWNED_REF('rwt-tests.example.org'));
    expect(record.lookupRef).not.toBe(first.lookupRef);
    expect(j1dRunnerAdmission({ [J1D_ADMISSION_ENV]: r.file, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '3' }, (p) => readFileSync(p, 'utf8')).admitted).toBe(true);
  });

  it('Sam: J1.d requires a recovery-eligible domain; unset or example.com fails before admission or J1.a, writing nothing', () => {
    for (const domain of ['', '   ', 'example.com', 'Example.COM', ' example.com ']) {
      const r = admit({ RWT_J1D_LEG: 'J1D-ON-J1A', LIVE_TEST_EMAIL_DOMAIN: domain });
      expect({ domain, status: r.status }).toEqual({ domain, status: 1 });
      expect(r.stdout).toContain('J1.d needs a recovery-eligible LIVE_TEST_EMAIL_DOMAIN');
      expect(r.files).toEqual([]);
    }
    // Unset entirely (the variable absent, not just empty).
    const temp = mkdtempSync(path.join(tmpdir(), 'j1d-admission-')); dirs.push(temp);
    const unset = spawnSync('bash', ['-c', `set -euo pipefail\n${block}`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '',
      RUNNER_TEMP: temp, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1', DIAGNOSTIC_DAST_SPEC: SPEC, RWT_J1D_LEG: 'J1D-ON-J1A' } });
    expect(unset.status).toBe(1);
    expect(readdirSync(temp)).toEqual([]);
  });

  it('the workflow accepts exactly the domains interrupted-run recovery may delete under (parity with deletionDomain)', () => {
    for (const domain of ['rwt-tests.example.org', 'Mail.Example.NET', 'a.io', 'example.com', 'EXAMPLE.COM', '', 'localhost',
      'bad_domain.org', '-lead.example.org', 'trail-.example.org', 'x.' + 'a'.repeat(64) + '.com', 'no-tld.', 'two..dots.org']) {
      const accepted = admit({ RWT_J1D_LEG: 'J1D-ON-J1A', LIVE_TEST_EMAIL_DOMAIN: domain }).status === 0;
      expect({ domain, accepted }).toEqual({ domain, accepted: deletionDomain(domain) !== null });
    }
  });

  it('ordinary J1.a (no J1.d input) is unchanged: no domain requirement, nothing written', () => {
    const r = admit({ RWT_J1D_LEG: '', LIVE_TEST_EMAIL_DOMAIN: '' });
    expect(r.status).toBe(0);
    expect(r.files).toEqual([]);
  });

  it('CONTROL: the earlier account shape (…-j1d-<run>-<attempt>) is one interrupted-run recovery would NOT recognise', () => {
    expect(ownedPrefixOf('rwt-journey-open-mic-j1d-4242-1@example.com', 'example.com')).toBeNull();
  });

  it('NEGATIVE: any other value, or the right value with another spec, fails before the spec and writes nothing', () => {
    for (const env of [{ RWT_J1D_LEG: 'yes' }, { RWT_J1D_LEG: 'j1d-on-j1a' }, { RWT_J1D_LEG: 'J1D-ON-J1A ' },
      { RWT_J1D_LEG: 'J1D-ON-J1A', DIAGNOSTIC_DAST_SPEC: 'tests/live/rwt-save-retry-recovery.live.spec.ts' },
      { RWT_J1D_LEG: 'J1D-ON-J1A', DIAGNOSTIC_DAST_SPEC: '' }]) {
      const r = admit(env);
      expect({ env, status: r.status }).toEqual({ env, status: 1 });
      expect(r.stdout).toContain('rwt_j1d_leg is accepted only as J1D-ON-J1A');
      expect(r.files).toEqual([]);
      expect(existsSync(r.file) && r.file !== '').toBe(false);
    }
  });
});
