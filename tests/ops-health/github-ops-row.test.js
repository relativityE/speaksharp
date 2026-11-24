import { describe, it, expect } from 'vitest';
import { evaluateGithubRow } from '../../scripts/lib/github-ops-row.mjs';
import { exitCodeForRows, renderMarkdown, renderPublicSummary, summarize } from '../../scripts/lib/ops-health-report.mjs';

const REPO = 'relativityE/speaksharp';

// A URL-aware fetch: matches the request URL to a queue of outcomes so a full GitHub row (repo metadata +
// rc-gates list + rc jobs + ci + canary) can be scripted per endpoint. Counts calls per matcher.
const res = (status, body = {}, headers = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() in lower ? lower[n.toLowerCase()] : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};

const gate3JobsBody = { jobs: [{ name: 'Gate 3 - DAST / Running App', steps: [{ name: 'Run DAST Live Gate', conclusion: 'success' }] }] };
const okRunsBody = { workflow_runs: [{ id: 500, head_branch: 'main', status: 'completed', conclusion: 'success', html_url: 'u' }] };
const healthySubchecks = (url) => {
  if (url.includes('/actions/workflows/rc-gates.yml/runs')) return res(200, okRunsBody);
  if (url.includes('/actions/runs/500/jobs')) return res(200, gate3JobsBody);
  if (url.includes('/actions/workflows/ci.yml/runs')) return res(200, { workflow_runs: [{ status: 'completed', conclusion: 'success' }] });
  if (url.includes('/actions/workflows/canary.yml/runs')) return res(200, { workflow_runs: [{ status: 'completed', conclusion: 'success' }] });
  return null;
};

const routedFetch = (repoOutcomes) => {
  const repoQ = [...repoOutcomes];
  const calls = { repo: 0, total: 0 };
  const fn = async (url) => {
    calls.total += 1;
    if (url.endsWith(`/repos/${REPO}`)) {
      calls.repo += 1;
      const o = repoQ.length > 1 ? repoQ.shift() : repoQ[0];
      if (o instanceof Error) throw o;
      return o;
    }
    const sub = healthySubchecks(url);
    if (sub) return sub;
    return res(404, { message: 'unmapped' });
  };
  fn.calls = calls;
  return fn;
};

const deps = (fetchImpl) => ({
  fetch: fetchImpl,
  sleep: async () => {},
  random: () => 0.5,
  now: () => 0,
  setTimer: () => 0,
  clearTimer: () => {},
  onDiagnostic: () => {},
});

const options = { maxAttempts: 3, perAttemptTimeoutMs: 15_000, totalBudgetMs: 30_000 };

describe('evaluateGithubRow — integration + process exit semantics', () => {
  it('repo 503→200 with healthy sub-checks → GitHub REVIEW (yellow) and process exit 0', async () => {
    const f = routedFetch([res(503), res(200, { full_name: REPO, private: false })]);
    const row = await evaluateGithubRow(REPO, 'ghp_FAKE', deps(f), options);
    expect(row.status).toBe('warn');
    expect(row.detail).toContain('recovered after 2 attempts');
    expect(exitCodeForRows([{ ...row, name: 'GitHub API' }])).toBe(0);
  });

  it('repo 503×3 → GitHub RED and process exit 1, naming the failing sub-check', async () => {
    const f = routedFetch([res(503), res(503), res(503)]);
    const row = await evaluateGithubRow(REPO, 'ghp_FAKE', deps(f), options);
    expect(row.status).toBe('fail');
    expect(row.detail).toContain('repository metadata'); // not "github=503"
    expect(row.detail).toContain('RED');
    expect(exitCodeForRows([{ ...row, name: 'GitHub API' }])).toBe(1);
    expect(f.calls.repo).toBe(3);
  });

  it('repo 429 with no headers → GitHub RED (RATE_LIMITED) and no busy retry', async () => {
    const f = routedFetch([res(429, {})]);
    const row = await evaluateGithubRow(REPO, 'ghp_FAKE', deps(f), options);
    expect(row.status).toBe('fail');
    expect(row.detail).toContain('RATE_LIMITED');
    expect(exitCodeForRows([{ ...row, name: 'GitHub API' }])).toBe(1);
    expect(f.calls.repo).toBe(1); // did not hammer
  });

  it('all sub-checks healthy on first try → GitHub GREEN (pass), exit 0', async () => {
    const f = routedFetch([res(200, { full_name: REPO, private: false })]);
    const row = await evaluateGithubRow(REPO, 'ghp_FAKE', deps(f), options);
    expect(row.status).toBe('pass');
    expect(exitCodeForRows([{ ...row, name: 'GitHub API' }])).toBe(0);
  });
});

describe('evaluateGithubRow — no token leak into JSON or Markdown output surfaces', () => {
  it('a failure whose response body carries a token never appears in the row, JSON, or Markdown', async () => {
    const secret = 'ghp_ROWLEVELLEAK99887766';
    // 403 with secondary language + token in the body → RATE_LIMITED terminal; body must be sanitized.
    const f = routedFetch([res(403, { message: `secondary rate limit; token=${secret}` })]);
    const row = await evaluateGithubRow(REPO, secret, deps(f), options);
    const check = { name: 'GitHub API', question: 'Can we query repository metadata and release workflows?', status: row.status, detail: row.detail, latencyMs: 1, checkedAt: 't', drilldownUrl: row.drilldownUrl };
    const payload = { generatedAt: 't', baseUrl: 'b', repo: REPO, runContext: 'GitHub Actions', summary: summarize([check]), checks: [check] };

    const json = JSON.stringify(payload);
    const markdown = renderMarkdown(payload);
    expect(row.status).toBe('fail');
    expect(json).not.toContain(secret);
    expect(markdown).not.toContain(secret);
    expect(json).not.toContain('Authorization');
    expect(markdown).not.toContain('Authorization');
  });
});


it('records GitHub and Actions access even when a real CI failure still gates release', async () => {
  const runAt = '2026-11-24T13:00:00.000Z';
  const f = async (url) => {
    if (url.endsWith('/repos/' + REPO)) return res(200, { full_name: REPO });
    if (url.includes('/ci.yml/runs')) return res(200, { workflow_runs: [
      { id: 381, head_branch: 'main', status: 'completed', conclusion: 'failure', updated_at: runAt,
        html_url: 'https://elsewhere.invalid/untrusted?secret=value' },
    ] });
    if (url.includes('/rc-gates.yml/runs')) return res(200, { workflow_runs: [] });
    return healthySubchecks(url) ?? res(404);
  };
  const row = { name: 'GitHub API', ...await evaluateGithubRow(REPO, 'fake-token', deps(f), options) };
  expect(row.status).toBe('fail');
  expect(exitCodeForRows([row])).toBe(1);
  const { checks } = renderPublicSummary({ summary: summarize([row]), checks: [row] });
  expect(checks[0].github.repository).toBe('pass');
  expect(checks[0].github.actions).toBe('pass');
  expect(checks[0].github.workflows.find(({ kind }) => kind === 'ci')).toEqual({
    kind: 'ci', outcome: 'failed', branch: 'main', runAt, url: 'https://github.com/' + REPO + '/actions/runs/381',
  });
  expect(checks[0].github.workflows.find(({ kind }) => kind === 'release').outcome).toBe('missing');
  expect(JSON.stringify(checks[0].github)).not.toContain('secret=value');
  const markdown = renderMarkdown({ summary: summarize([row]), checks: [row] });
  expect(markdown).toContain('GitHub access | 🟢 OK');
  expect(markdown).toContain('Latest CI (main): failed');
  expect(markdown).toContain('Verdict: ACTION REQUIRED');
});


it('does not conflate authentication success with fully verified Actions access', async () => {
  const f = async (url) => {
    if (url.endsWith('/repos/' + REPO)) return res(200, { full_name: REPO });
    if (url.includes('/ci.yml/runs')) return res(403, { message: 'Access denied' });
    return healthySubchecks(url) ?? res(404);
  };
  const row = await evaluateGithubRow(REPO, 'fake-token', deps(f), options);
  expect(row.github.repository).toBe('pass');
  expect(row.github.actions).toBe('warn');
  expect(row.github.workflows.find(({ kind }) => kind === 'ci').outcome).toBe('unavailable');
  expect(exitCodeForRows([row])).toBe(1);
});
