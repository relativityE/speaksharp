import { describe, it, expect } from 'vitest';
import { selectAuthoritativeRcRun, FULL_LIVE_GATE_STEP } from '../../scripts/lib/authoritative-rc-run.mjs';

// A Gate 3 job whose FULL live gate step ran (authoritative) or was skipped (diagnostic single-spec run).
const gate3Job = (fullStepConclusion) => ([{
  name: 'Gate 3 - DAST / Running App',
  steps: [
    { name: 'Run DAST Local Gate', conclusion: 'success' },
    { name: FULL_LIVE_GATE_STEP, conclusion: fullStepConclusion },
    { name: 'Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)', conclusion: fullStepConclusion === 'skipped' ? 'failure' : 'skipped' },
  ],
}]);

describe('selectAuthoritativeRcRun', () => {
  it('a more-recent DIAGNOSTIC run (full live gate skipped) does NOT override the authoritative full Gate 3', async () => {
    const runs = [
      // most recent: a DIAGNOSTIC single-spec run dispatched from main → full live gate step skipped, and
      // it "failed" (as a diagnostic can). The old latest-run logic would have reported rc=failure.
      { id: 999, head_branch: 'main', status: 'completed', conclusion: 'failure', html_url: 'u999' },
      // a diagnostic run on a side branch (validate/*)
      { id: 998, head_branch: 'validate/x', status: 'completed', conclusion: 'success', html_url: 'u998' },
      // the authoritative full Gate 3 on main
      { id: 500, head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'u500' },
    ];
    const getJobs = async (id) => {
      if (id === 999) return gate3Job('skipped'); // diagnostic → full step skipped
      if (id === 500) return gate3Job('success'); // authoritative → full step ran
      return [];
    };

    const r = await selectAuthoritativeRcRun(runs, getJobs);
    expect(r.runId).toBe(500);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('run 500'); // ops-health output includes the run id it used
  });

  it('reports rc=failure when the authoritative full Gate 3 itself failed', async () => {
    const runs = [{ id: 501, head_branch: 'main', status: 'completed', conclusion: 'failure', html_url: 'u' }];
    const r = await selectAuthoritativeRcRun(runs, async () => gate3Job('failure'));
    expect(r.runId).toBe(501);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('rc=failure');
  });

  it('ignores non-main runs even if they are full Gate 3 runs', async () => {
    const runs = [{ id: 42, head_branch: 'validate/x', status: 'completed', conclusion: 'success', html_url: 'u' }];
    const r = await selectAuthoritativeRcRun(runs, async () => gate3Job('success'));
    expect(r.runId).toBeNull();
    expect(r.status).toBe('warn');
  });

  it('skips in-progress runs and selects the latest completed authoritative run', async () => {
    const runs = [
      { id: 2, head_branch: 'main', status: 'in_progress', conclusion: null, html_url: 'u' },
      { id: 500, head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'u500' },
    ];
    const getJobs = async (id) => (id === 500 ? gate3Job('success') : []);
    const r = await selectAuthoritativeRcRun(runs, getJobs);
    expect(r.runId).toBe(500);
  });

  it('warns (never silently green) when no authoritative full Gate 3 run exists in the window', async () => {
    const runs = [{ id: 1, head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'u' }];
    // Only a diagnostic run exists (full live gate skipped).
    const r = await selectAuthoritativeRcRun(runs, async () => gate3Job('skipped'));
    expect(r.runId).toBeNull();
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('no-authoritative');
  });
});
