// Ops-health "GitHub API" row — assembles the four GitHub sub-checks (repository metadata, authoritative
// RC status, ci|canary workflow query) on top of the resilient GET helper (github-ops-fetch.mjs).
//
// Design points enforced here:
//   - ONE hard deadline is created per row and shared across every sub-check request (repository, RC list,
//     RC jobs, ci, canary), so the row's total duration can never multiply by the number of sub-checks.
//   - Each sub-check is labeled, so a failure names the exact endpoint instead of collapsing to github=503.
//   - A transient failure that later succeeds folds to a non-gating REVIEW ("recovered after N attempts").
//   - The row never throws: a terminal GithubOpsError becomes a labeled `fail` row (detail = sanitized
//     message) so the caller's aggregation/exit-code logic stays simple and deterministic.
import { githubGet, GithubOpsError, clampPositiveInt, BOUNDS } from './github-ops-fetch.mjs';
import { selectAuthoritativeRcRun, GATE3_JOB_RE, FULL_LIVE_GATE_STEP } from './authoritative-rc-run.mjs';

// Local copy of the tiny row aggregator (kept here to avoid a circular import with ops-health.mjs).
function combineParts(parts, drilldownUrl) {
  const failures = parts.filter((part) => part.ok === false || part.status === 'fail');
  const skipped = parts.filter((part) => part.skipped || part.ok === null || part.status === 'warn');
  return {
    status: failures.length ? 'fail' : skipped.length ? 'warn' : 'pass',
    detail: parts.map((part) => part.detail).join('; '),
    drilldownUrl,
  };
}

// Fold recovered-after-retry transients into a non-gating REVIEW so the recovery stays visible in the
// release ledger without raising a hard product failure.
export function combinedGithub(parts, probe, drilldownUrl) {
  const base = combineParts(parts, drilldownUrl);
  if (!probe.recoveries.length) return base;
  const note = probe.recoveries.map((r) => `${r.label} recovered after ${r.attempts} attempts`).join(', ');
  return {
    status: base.status === 'pass' ? 'warn' : base.status,
    detail: `${base.detail}; GitHub API ${note}`,
    drilldownUrl,
  };
}

// A resilient GitHub probe with a single shared deadline for the whole row.
export function createGithubProbe(token, deps = {}, options = {}) {
  const now = deps.now ?? (() => Date.now());
  const config = {
    maxAttempts: clampPositiveInt(options.maxAttempts ?? process.env.OPS_HEALTH_GH_MAX_ATTEMPTS, BOUNDS.maxAttempts),
    perAttemptTimeoutMs: clampPositiveInt(options.perAttemptTimeoutMs ?? process.env.OPS_HEALTH_TIMEOUT_MS, BOUNDS.perAttemptTimeoutMs),
    totalBudgetMs: clampPositiveInt(options.totalBudgetMs ?? process.env.OPS_HEALTH_GH_BUDGET_MS, BOUNDS.totalBudgetMs),
  };
  const deadline = now() + config.totalBudgetMs; // shared by every sub-check request
  const recoveries = [];
  return {
    recoveries,
    deadline,
    async getJson(pathname, subLabel) {
      const result = await githubGet(
        `https://api.github.com${pathname}`,
        { token, label: subLabel, deadline, maxAttempts: config.maxAttempts, perAttemptTimeoutMs: config.perAttemptTimeoutMs, totalBudgetMs: config.totalBudgetMs },
        deps,
      );
      if (result.recovered) recoveries.push({ label: subLabel, attempts: result.attempts });
      return result.body;
    },
  };
}

async function latestWorkflow(probe, repo, workflowFile, label) {
  const body = await probe.getJson(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`, `${label} workflow query`);
  const run = body?.workflow_runs?.[0];
  if (!run) return { ok: false, detail: `${label}=missing` };
  if (run.status !== 'completed') {
    return { status: 'warn', detail: `${label}=${run.status}` };
  }
  return { ok: run.conclusion === 'success', detail: `${label}=${run.conclusion ?? 'unknown'}` };
}

async function authoritativeRcStatus(probe, repo) {
  const body = await probe.getJson(`/repos/${repo}/actions/workflows/rc-gates.yml/runs?branch=main&per_page=20`, 'authoritative RC status');
  const runs = body?.workflow_runs ?? [];
  const getJobs = async (runId) => {
    const jobsBody = await probe.getJson(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, 'authoritative RC status');
    return jobsBody?.jobs ?? [];
  };
  const result = await selectAuthoritativeRcRun(runs, getJobs);
  return result.status ? { status: result.status, detail: result.detail } : { ok: result.ok, detail: result.detail };
}

/**
 * Evaluate the whole GitHub API row. Always returns a row result `{ status, detail, drilldownUrl }`:
 *   - 'pass'  → all sub-checks green on the first try;
 *   - 'warn'  → all sub-checks ultimately passed but one recovered after retries, or a workflow is in-progress;
 *   - 'fail'  → a terminal GitHub failure (RED / RATE_LIMITED / BUDGET_EXHAUSTED); detail names the sub-check.
 * Never throws for GitHub failures (they become a labeled fail row).
 */
export async function evaluateGithubRow(repo, token, deps = {}, options = {}) {
  const drilldownUrl = `https://github.com/${repo}/actions`;
  const probe = createGithubProbe(token, deps, options);
  try {
    const body = await probe.getJson(`/repos/${repo}`, 'repository metadata');
    const checks = await Promise.all([
      { ok: body?.full_name === repo, detail: `repo=${body?.full_name ?? 'unknown'}; private=${body?.private === true}` },
      authoritativeRcStatus(probe, repo),
      latestWorkflow(probe, repo, 'ci.yml', 'ci'),
      latestWorkflow(probe, repo, 'canary.yml', 'canary'),
    ]);
    return combinedGithub(checks, probe, drilldownUrl);
  } catch (error) {
    if (error instanceof GithubOpsError) {
      return { status: 'fail', detail: error.message, drilldownUrl };
    }
    throw error; // unexpected non-GitHub error — let the caller's row() wrapper handle it
  }
}

export { GATE3_JOB_RE, FULL_LIVE_GATE_STEP };
