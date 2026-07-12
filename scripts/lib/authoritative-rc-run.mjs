// Ops-health "rc" (release-candidate) health signal — selects the AUTHORITATIVE full Gate 3 run rather
// than the single most-recent rc-gates.yml run.
//
// Why: /admin/ops-status is a release-readiness dashboard. The old logic read the latest rc-gates run
// across all branches/spec types, so a DIAGNOSTIC single-spec dispatch (or one on a side branch) could
// flip `rc` to failure/success and mislead the GO decision. An authoritative run is:
//   - head branch `main`;
//   - a real full live gate (the `Run DAST Live Gate` step actually ran — diagnostic single-spec runs
//     SKIP it and run `Run DAST Live Gate (DIAGNOSTIC single spec …)` instead);
//   - completed with conclusion success|failure.
// (Production base URL is a workflow_dispatch input and is not exposed by the Actions REST API; the
// main-branch + full-live-gate filters are the API-observable proxy. See PR notes.)

export const GATE3_JOB_RE = /Gate 3 - DAST/i;
export const FULL_LIVE_GATE_STEP = 'Run DAST Live Gate';

/**
 * @param {Array<{id:number, head_branch?:string, status?:string, conclusion?:string, html_url?:string}>} runs
 *        rc-gates runs, most-recent first.
 * @param {(runId:number) => Promise<Array<{name?:string, steps?:Array<{name?:string, conclusion?:string}>}>>} getJobs
 * @returns {Promise<{ok?:boolean, status?:string, detail:string, runId:number|null, url:string|null}>}
 *          Shape is compatible with ops-health's row aggregator (`{ok, detail}` or `{status, detail}`).
 */
export async function selectAuthoritativeRcRun(runs, getJobs) {
  for (const run of runs ?? []) {
    if (run.head_branch !== 'main') continue;
    if (run.status !== 'completed') continue;
    if (run.conclusion !== 'success' && run.conclusion !== 'failure') continue;

    let jobs;
    try {
      jobs = await getJobs(run.id);
    } catch {
      continue;
    }

    const gate3 = (jobs ?? []).find((job) => GATE3_JOB_RE.test(job?.name ?? ''));
    if (!gate3) continue;

    const fullStep = (gate3.steps ?? []).find((step) => step?.name === FULL_LIVE_GATE_STEP);
    // The full live gate step ran (not skipped) → a real full Gate 3, NOT a diagnostic single-spec run.
    if (fullStep && fullStep.conclusion && fullStep.conclusion !== 'skipped') {
      return {
        ok: run.conclusion === 'success',
        detail: `rc=${run.conclusion}(run ${run.id})`,
        runId: run.id,
        url: run.html_url ?? null,
      };
    }
  }

  return {
    status: 'warn',
    detail: 'rc=no-authoritative-full-gate-3-run-found',
    runId: null,
    url: null,
  };
}
