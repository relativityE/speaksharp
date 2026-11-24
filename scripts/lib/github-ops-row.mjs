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

const repoUrl = (repo) => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo) ? 'https://github.com/' + repo : null;
const runInfo = (repo, workflowFile, run) => {
  const base = repoUrl(repo);
  const time = [run?.updated_at, run?.created_at].find((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return {
    url: base && Number.isSafeInteger(run?.id) && run.id > 0 ? base + '/actions/runs/' + run.id
      : base ? base + '/actions/workflows/' + workflowFile : null,
    runAt: time ? new Date(time).toISOString() : null,
    branch: run?.head_branch === 'main' ? 'main' : run?.head_branch ? 'other' : null,
  };
};

async function latestWorkflow(probe, repo, workflowFile, label) {
  const body = await probe.getJson('/repos/' + repo + '/actions/workflows/' + workflowFile + '/runs?per_page=1', label + ' workflow query');
  const run = body?.workflow_runs?.[0];
  const meta = { ...runInfo(repo, workflowFile, run), apiReadable: Array.isArray(body?.workflow_runs) };
  if (!run) return { ok: false, detail: label + '=missing', outcome: 'missing', ...meta };
  if (run.status !== 'completed') {
    return { status: 'warn', detail: label + '=' + run.status, outcome: 'pending', ...meta };
  }
  return { ok: run.conclusion === 'success', detail: label + '=' + (run.conclusion ?? 'unknown'),
    outcome: run.conclusion === 'success' ? 'passed' : 'failed', ...meta };
}

async function authoritativeRcStatus(probe, repo) {
  const workflowFile = 'rc-gates.yml';
  const body = await probe.getJson('/repos/' + repo + '/actions/workflows/' + workflowFile + '/runs?branch=main&per_page=20', 'authoritative RC status');
  if (body?.workflow_runs != null && !Array.isArray(body.workflow_runs)) {
    return { ok: false, detail: 'rc=invalid-run-list', outcome: 'unavailable', apiReadable: false, ...runInfo(repo, workflowFile, null) };
  }
  const runs = body?.workflow_runs ?? [];
  const getJobs = async (runId) => {
    const jobsBody = await probe.getJson('/repos/' + repo + '/actions/runs/' + runId + '/jobs?per_page=50', 'authoritative RC status');
    return jobsBody?.jobs ?? [];
  };
  const result = await selectAuthoritativeRcRun(runs, getJobs);
  const meta = { ...runInfo(repo, workflowFile, runs.find((run) => run.id === result.runId)),
    apiReadable: Array.isArray(body?.workflow_runs) };
  return result.status ? { status: result.status, detail: result.detail, outcome: 'missing', ...meta }
    : { ok: result.ok, detail: result.detail, outcome: result.ok ? 'passed' : 'failed', ...meta };
}

/** Maintain the legacy aggregate's exact gating semantics while keeping platform response separate from workflow outcomes. */
export async function evaluateGithubRow(repo, token, deps = {}, options = {}) {
  const base = repoUrl(repo);
  const drilldownUrl = base ? base + '/actions' : null;
  const probe = createGithubProbe(token, deps, options);
  const definitions = [
    ['ci', 'ci.yml', () => latestWorkflow(probe, repo, 'ci.yml', 'ci')],
    ['canary', 'canary.yml', () => latestWorkflow(probe, repo, 'canary.yml', 'canary')],
    ['release', 'rc-gates.yml', () => authoritativeRcStatus(probe, repo)],
  ];
  const report = (repository, actions, workflows) => ({
    repository, actions, repositoryUrl: base, actionsUrl: drilldownUrl, workflows,
  });
  try {
    const body = await probe.getJson('/repos/' + repo, 'repository metadata');
    const repositoryOk = body?.full_name === repo;
    const [ci, canary, release] = await Promise.all(definitions.map(async ([, file, check]) => {
      try { return await check(); }
      catch (error) {
        if (!(error instanceof GithubOpsError)) throw error;
        return { ok: false, detail: error.message, outcome: 'unavailable', apiReadable: false, ...runInfo(repo, file, null) };
      }
    }));
    // Preserve the existing aggregate ordering and failure handling for old readers and workflow exit code.
    const aggregate = combinedGithub([
      { ok: repositoryOk, detail: 'repo=' + (repositoryOk ? repo : 'unknown') + '; private=' + (body?.private === true) },
      release, ci, canary,
    ], probe, drilldownUrl);
    const results = [ci, canary, release];
    const readable = results.filter((item) => item.apiReadable).length;
    const actions = readable === 3 ? 'pass' : readable ? 'warn' : 'fail';
    const workflows = results.map(({ outcome, url, runAt, branch }, index) => ({
      kind: definitions[index][0], outcome, url, runAt, branch,
    }));
    return { ...aggregate, github: report(repositoryOk ? 'pass' : 'fail', actions, workflows) };
  } catch (error) {
    if (error instanceof GithubOpsError) {
      const workflows = definitions.map(([kind, file]) => ({
        kind, outcome: 'unavailable', ...runInfo(repo, file, null),
      }));
      return { status: 'fail', detail: error.message, drilldownUrl, github: report('fail', 'skip', workflows) };
    }
    throw error; // unexpected non-GitHub error — let the caller's row() wrapper handle it
  }
}

export { GATE3_JOB_RE, FULL_LIVE_GATE_STEP };
