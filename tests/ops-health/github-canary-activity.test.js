import { describe, expect, it } from 'vitest';
import { evaluateCanaryActivity } from '../../scripts/lib/github-canary-activity.mjs';
import { exitCodeForRows, renderMarkdown, renderPublicSummary, summarize } from '../../scripts/lib/ops-health-report.mjs';

const repo = 'relativityE/speaksharp';
const now = '2026-11-22T20:18:00Z';
const recordedRun = 45025206065;
const run = (id, at, conclusion, extra = {}) => ({
  id, created_at: '2026-11-22T00:00:00Z', run_started_at: at,
  event: 'schedule', status: 'completed', conclusion, run_attempt: 1, ...extra,
});
const runs = (workflow_runs, total_count = workflow_runs.length) => ({ total_count, workflow_runs });
const jobs = (items, total_count = items.length) => ({ total_count, jobs: items });
const response = (data) => ({
  ok: data !== undefined, status: data === undefined ? 404 : 200,
  headers: { get: () => null }, json: async () => data, text: async () => JSON.stringify(data ?? {}),
});
const mock = (list, supplements = {}) => {
  const paths = [];
  const deps = {
    fetch: async (value) => {
      const { pathname, search } = new URL(value);
      paths.push(pathname + search);
      const key = pathname.split('/actions/')[1];
      const routes = key.startsWith('workflows/') ? list : supplements[key.replace('runs/', '')];
      return response(typeof routes === 'function' ? routes(new URLSearchParams(search).get('page')) : routes);
    },
    onDiagnostic: () => {},
  };
  return { paths, check: () => evaluateCanaryActivity(repo, 'ghp_FAKE', now, deps) };
};
const payload = (canaryActivity) => ({
  generatedAt: now, baseUrl: 'https://example.test', repo, runContext: 'GitHub Actions',
  checks: [], summary: summarize([]), canaryActivity,
});
const provisionJob = (id, at) => ({
  id, name: 'canary-check (active-trial)', conclusion: 'failure', steps: [{
    number: 6, name: 'Provision Canary User (active-trial)', conclusion: 'failure',
    completed_at: at, raw_log: 'must-not-publish-token',
  }],
});

describe('Canary UTC Ops Health rollup', () => {
  it('shows an independently successful latest run without losing a failed prior attempt, exact time, step and log link', async () => {
    const s = '2026-11-22T13:00:39Z';
    const r = mock(runs([
      run(recordedRun, '2026-11-22T15:00:00Z', 'success', { run_attempt: 2 }),
      run(600, '2026-11-22T19:00:00Z', 'failure', { event: 'workflow_dispatch' }),
    ]), {
      ['' + recordedRun + '/attempts/1']: run(recordedRun, s, 'failure'),
      ['' + recordedRun + '/attempts/1/jobs']: jobs([
        provisionJob(137216798124, '2026-11-22T13:02:04Z'),
        { id: 137217032435, name: 'canary-result', conclusion: 'failure', completed_at: '2026-11-22T13:02:09Z' },
      ]),
      '600/attempts/1/jobs': jobs([provisionJob(601, '2026-11-22T19:02:04Z')]),
    });
    const result = await r.check();
    expect(result.latest.trigger).toBe('manual');
    expect(result.latest.status).toBe('failed');
    expect(result.latestGreen.attempt).toBe(2);
    expect(result.firstFailure.attempt.attempt).toBe(1);
    expect(result.distinct.length).toBe(0);
    expect(result.unclassifiedFailures).toBe(0);
    expect(r.paths[0]).toContain('created=2026-11-22');
    expect(r.paths.some((p) => p.includes('/attempts/2/jobs'))).toBe(false);
    const md = renderMarkdown(payload(result));
    expect(md).toContain('- Latest run: [#600 (attempt 1)]');
    expect(md).toContain('- Latest pass: [#45025206065 (attempt 2)]');
    expect(md).toContain('First failure: 2026-11-22T13:02:04.000Z, [canary-check (active-trial): Provision Canary User (active-trial)](https://github.com/relativityE/speaksharp/actions/runs/45025206065/job/137216798124#step:6:1)');
    expect(md).not.toContain('must-not-publish-token');
    expect(JSON.stringify(renderPublicSummary(payload(result)))).not.toContain('must-not-publish-token');
    expect(exitCodeForRows([])).toBe(0);
  });

  it('keeps the first provision failure and later billing step after a pass, deduplicating only known locations', async () => {
    const billingJob = { id: 703, name: 'canary-check (billing-qualification)', conclusion: 'failure',
      steps: [{ number: 14, name: 'Stripe Test-Mode/Test-Clock Billing Qualification (billing-qualification)',
        conclusion: 'failure', completed_at: '2026-11-22T16:37:25Z' }] };
    const result = await mock(runs([
      run(1, '2026-11-22T15:37:27Z', 'failure'),
      run(2, '2026-11-22T16:35:23Z', 'failure'),
      run(3, '2026-11-22T17:00:00Z', 'failure'),
      run(4, '2026-11-22T18:00:00Z', 'success'),
    ]), {
      '1/attempts/1/jobs': jobs([provisionJob(701, '2026-11-22T15:39:12Z')]),
      '2/attempts/1/jobs': jobs([
        provisionJob(702, '2026-11-22T16:38:21Z'),
        billingJob,
        { id: 704, name: 'canary-result', conclusion: 'failure', completed_at: '2026-11-22T16:39:00Z' },
      ]),
      '3/attempts/1/jobs': jobs([
        { ...billingJob, id: 705, steps: [{ ...billingJob.steps[0], completed_at: '2026-11-22T17:02:00Z' }] },
        { id: 706, name: billingJob.name, conclusion: 'failure', completed_at: '2026-11-22T17:03:00Z' },
      ]),
    }).check();
    expect(result.latest.id).toBe(4);
    expect(result.latestGreen.id).toBe(4);
    expect(result.firstFailure.evidence.logUrl).toContain('/1/job/701#step:6:1');
    expect(result.distinct.map(({ evidence }) => [evidence.logUrl, evidence.reasonCode]))
      .toEqual([['https://github.com/relativityE/speaksharp/actions/runs/2/job/703#step:14:1', null]]);
    expect(result.unclassifiedFailures).toBe(1);
    const md = renderMarkdown(payload(result));
    expect(md).toContain('Distinct later failed step: 2026-11-22T16:37:25.000Z');
    expect(md).not.toContain('canary-result');
  });

  it('only renders later failures with a different explicit GitHub reason code, and labels job-end fallback', async () => {
    const repeated = (id, conclusion) => jobs([{ id, name: 'canary-check (active-trial)',
      conclusion, completed_at: '2026-11-22T18:00:00Z' }]);
    const result = await mock(runs([1, 2, 3, 4].map((n) => run(n, '2026-11-22T0' + n + ':00:00Z', 'failure'))), {
      '1/attempts/1/jobs': repeated(701, 'timed_out'),
      '2/attempts/1/jobs': repeated(702, 'startup_failure'),
      '3/attempts/1/jobs': repeated(703, 'startup_failure'),
      '4/attempts/1/jobs': repeated(704, 'failure'),
    }).check();
    expect(result.distinct.map(({ evidence }) => evidence.reasonCode)).toEqual(['startup_failure']);
    expect(result.unclassifiedFailures).toBe(1);
    const md = renderMarkdown(payload(result));
    expect(md).toContain('2026-11-22T18:00:00.000Z (job ended)');
    expect(md).toContain('Distinct later failure');
  });

  it('retains distinct explicit terminal codes at the same known step, but not redacted step identities', async () => {
    const ended = '2026-11-22T18:00:00Z';
    const failed = (id, conclusion, name) => {
      const job = provisionJob(id, ended);
      return { ...job, conclusion, steps: [{ ...job.steps[0], conclusion, ...(name ? { name } : {}) }] };
    };
    const result = await mock(runs([1, 2, 3, 4].map((n) => run(n, '2026-11-22T0' + n + ':00:00Z', 'failure'))), {
      '1/attempts/1/jobs': jobs([failed(711, 'timed_out')]),
      '2/attempts/1/jobs': jobs([failed(712, 'startup_failure')]),
      '3/attempts/1/jobs': jobs([failed(713, 'failure')]),
      '4/attempts/1/jobs': jobs([failed(714, 'action_required', 'unrecognized sensitive text')]),
    }).check();
    expect(result.distinct.map(({ evidence }) => evidence.reasonCode)).toEqual(['startup_failure']);
    expect(result.unclassifiedFailures).toBe(1);
    expect(JSON.stringify(result)).not.toContain('unrecognized sensitive text');
  });

  it('keeps the first generic failure, reports the first explicit timeout at that step, then preserves both after a pass', async () => {
    const timeout = (id, at) => {
      const job = provisionJob(id, at);
      return { ...job, conclusion: 'timed_out', steps: [{ ...job.steps[0], conclusion: 'timed_out' }] };
    };
    const result = await mock(runs([
      run(1, '2026-11-22T01:00:00Z', 'failure'),
      run(2, '2026-11-22T02:00:00Z', 'failure'),
      run(3, '2026-11-22T03:00:00Z', 'failure'),
      run(4, '2026-11-22T04:00:00Z', 'success'),
    ]), {
      '1/attempts/1/jobs': jobs([provisionJob(721, '2026-11-22T01:01:00Z')]),
      '2/attempts/1/jobs': jobs([timeout(722, '2026-11-22T02:01:00Z')]),
      '3/attempts/1/jobs': jobs([timeout(723, '2026-11-22T03:01:00Z')]),
    }).check();
    expect(result.firstFailure.evidence.reasonCode).toBe(null);
    expect(result.firstFailure.evidence.logUrl).toContain('/1/job/721#step:6:1');
    expect(result.distinct.map(({ evidence }) => [evidence.reasonCode, evidence.endedAt, evidence.logUrl])).toEqual([
      ['timed_out', '2026-11-22T02:01:00.000Z', 'https://github.com/relativityE/speaksharp/actions/runs/2/job/722#step:6:1'],
    ]);
    expect(result.latest.id).toBe(4);
    expect(result.latestGreen.id).toBe(4);
    expect(result.unclassifiedFailures).toBe(0);
  });

  it('shows red no-run only for a complete UTC date with no runs', async () => {
    expect(renderMarkdown(payload(await mock(runs([])).check()))).toContain('🔴 No run today.');
    expect(renderMarkdown(payload(await mock(runs([], 2)).check()))).not.toContain('🔴 No run today.');
    expect(renderMarkdown(payload(await mock(undefined).check()))).toContain('Run history unavailable');
  });

  it('paginates run and failed-job collections, and keeps data if later pages are unavailable', async () => {
    const first = Array.from({ length: 100 }, (_, i) => run(i + 1, '2026-11-22T05:00:00Z', 'success'));
    const last = run(900, '2026-11-22T06:00:00Z', 'failure');
    const firstJobs = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, conclusion: 'success' }));
    const result = await mock(
      (page) => runs(page === '1' ? first : [last], 101),
      { '900/attempts/1/jobs': (page) => jobs(page === '1' ? firstJobs : [provisionJob(101, '2026-11-22T06:02:04Z')], 101) },
    ).check();
    expect(result.coverage).toBe('complete');
    expect(result.latest.id).toBe(900);
    expect(result.firstFailure.evidence.logUrl).toContain('/900/job/101');
    const incomplete = await mock((page) => page === '1' ? runs(first, 101) : undefined).check();
    expect(incomplete.coverage).toBe('incomplete');
    expect(incomplete.latestGreen.id).toBe(100);
  });

  it('marks failed prior-attempt lookup as incomplete and never copies arbitrary names or bogus URLs', async () => {
    const result = await mock(runs([run(500, '2026-11-22T07:00:00Z', 'failure', { run_attempt: 2 })]), {
      '500/attempts/2/jobs': jobs([{ id: 700, conclusion: 'failure',
        name: 'secret arbitrary text', html_url: 'https://arbitrary.test',
        steps: [{ name: 'secret step name', conclusion: 'failure' }],
      }]),
    }).check();
    expect(result.coverage).toBe('incomplete');
    expect(result.firstFailure.evidence.endedAt).toBe(null);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.firstFailure.evidence.logUrl).toBe('https://github.com/relativityE/speaksharp/actions/runs/500/job/700');
  });
});
