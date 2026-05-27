#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = process.env.GITHUB_REPOSITORY || 'relativityE/speaksharp';
const baseUrl = (process.env.BASE_URL || 'https://speaksharp-public.vercel.app').replace(/\/$/, '');
const outputDir = process.env.OPS_HEALTH_OUTPUT_DIR || 'ops-health';
const publicOutputDir = process.env.OPS_HEALTH_PUBLIC_DIR || null;
const benchmarksPath = process.env.STT_BENCHMARKS_PATH || 'tests/STT_BENCHMARKS.json';
const generatedAt = new Date().toISOString();
const runContext = process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local shell';

const rows = [];

await row('App', 'Can users reach SpeakSharp?', async () => {
  const app = await http(baseUrl);
  return simple(app.ok, `Production app HTTP ${app.status}`, baseUrl, app.ms);
});

await row('Vercel API', 'Can we read the latest production deployment?', async () => {
  const token = env('VERCEL_ACCESS_TOKEN');
  const projectId = env('VERCEL_PROJECT_ID');
  const teamId = optionalEnv('VERCEL_TEAM_ID', ['VERCEL_ORG_ID']);
  let response = await vercelDeployments(projectId, token, teamId);
  let teamScopeRejected = false;

  if (teamId && response.status === 403) {
    teamScopeRejected = true;
    response = await vercelDeployments(projectId, token, null);
  }

  const body = json(await response.text());
  const deployment = body?.deployments?.[0];
  const ready = response.ok && deployment?.state === 'READY';
  const inProgress = response.ok && ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(deployment?.state);
  return {
    status: ready ? (teamScopeRejected ? 'warn' : 'pass') : inProgress ? 'warn' : 'fail',
    detail: deployment?.state
      ? `latest=${deployment.state}; url=${deployment.url ?? 'unknown'}${teamScopeRejected ? '; teamScope=403; used=unscoped' : ''}`
      : `http=${response.status}${teamScopeRejected ? '; teamScope=403; unscoped-retry-failed' : ''}`,
    drilldownUrl: 'https://vercel.com/dashboard',
  };
});

await row('Supabase API', 'Can clients reach Auth and SpeakSharp Edge Functions?', async () => {
  const supabaseUrl = env('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = env('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const auth = await http(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const usageLimitEdge = await edgePreflight('check-usage-limit');
  const tokenEdge = await edgeExpectedStatus('assemblyai-token', {
    method: 'POST',
    expectedStatus: 401,
    detailPrefix: 'assemblyai-token',
  });
  return combined([
    { ok: auth.ok, detail: `auth=${auth.status}` },
    usageLimitEdge,
    tokenEdge,
  ], 'https://supabase.com/dashboard');
});

await row('AssemblyAI API', 'Can Cloud STT provider credentials reach AssemblyAI?', async () => {
  const response = await http('https://api.assemblyai.com/v2/transcript', {
    headers: { authorization: env('ASSEMBLYAI_API_KEY') },
  });
  return simple(response.ok, `transcript-api=${response.status}`, 'https://www.assemblyai.com/dashboard/', response.ms);
});

await row('Gemini API', 'Can AI suggestions provider credentials reach Gemini?', async () => {
  const key = env('GEMINI_API_KEY', ['GOOGLE_API_KEY']);
  const response = await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  return simple(response.ok, `models=${response.status}`, 'https://aistudio.google.com/', response.ms);
});

await row('Stripe API', 'Can billing credentials reach Stripe and read product prices?', async () => {
  const secret = env('STRIPE_SECRET_KEY');
  const stripe = await http('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const checks = await Promise.all([
    { ok: stripe.ok, detail: `balance=${stripe.status}` },
    stripePrice(secret, 'basic', env('STRIPE_BASIC_PRICE_ID', ['VITE_STRIPE_BASIC_PRICE_ID'])),
    stripePrice(secret, 'pro', env('STRIPE_PRO_PRICE_ID', ['VITE_STRIPE_PRO_PRICE_ID', 'VITE_STRIPE_PRICE_ID'])),
  ]);
  return combined(checks, 'https://dashboard.stripe.com/');
});

await row('Sentry API', 'Can we query Sentry project health?', async () => {
  const apiBase = (process.env.SENTRY_API_BASE || 'https://sentry.io/api/0').replace(/\/$/, '');
  const org = env('SENTRY_ORG');
  const project = env('SENTRY_PROJECT');
  const response = await http(`${apiBase}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/`, {
    headers: { Authorization: `Bearer ${env('SENTRY_AUTH_TOKEN')}` },
  });
  return simple(response.ok, `project=${response.status}`, 'https://sentry.io/', response.ms);
});

await row('PostHog API', 'Can we query PostHog analytics?', async () => {
  const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
  const projectId = env('POSTHOG_PROJECT_ID');
  const response = await http(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env('POSTHOG_PERSONAL_API_KEY')}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT 1' }, name: 'SpeakSharp ops health query' }),
  });
  return simple(response.ok, `query=${response.status}`, 'https://us.posthog.com/', response.ms);
});

await row('GitHub API', 'Can we query repository metadata and release workflows?', async () => {
  const token = normalizeBearerToken(env('GITHUB_TOKEN', ['GH_PAT']));
  const body = await githubJson(`/repos/${repo}`, token);
  const checks = await Promise.all([
    { ok: body?.full_name === repo, detail: `repo=${body?.full_name ?? 'unknown'}; private=${body?.private === true}` },
    latestWorkflow(token, 'rc-gates.yml', 'rc'),
    latestWorkflow(token, 'ci.yml', 'ci'),
    latestWorkflow(token, 'canary.yml', 'canary'),
  ]);
  return combined(checks, `https://github.com/${repo}/actions`);
});

const summary = summarize(rows);
const payload = { generatedAt, baseUrl, repo, runContext, summary, checks: rows };
const publicPayload = renderPublicSummary(payload);
const markdown = renderMarkdown(payload);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'ops-health.json'), JSON.stringify(payload, null, 2));
await fs.writeFile(path.join(outputDir, 'ops-health.summary.json'), JSON.stringify(publicPayload, null, 2));
await fs.writeFile(path.join(outputDir, 'ops-health.md'), markdown);

if (publicOutputDir) {
  await fs.mkdir(publicOutputDir, { recursive: true });
  await fs.writeFile(path.join(publicOutputDir, 'ops-health.summary.json'), JSON.stringify(publicPayload, null, 2));
}

console.log(markdown);

if (summary.fail > 0) process.exitCode = 1;

async function row(name, question, fn) {
  const started = performance.now();
  try {
    const result = await fn();
    rows.push({
      name,
      question,
      status: result.status,
      detail: result.detail,
      latencyMs: result.latencyMs ?? Math.round(performance.now() - started),
      drilldownUrl: result.drilldownUrl ?? null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rows.push({
      name,
      question,
      status: message.startsWith('missing_env:') ? 'skip' : 'fail',
      detail: message.startsWith('missing_env:') ? `missing=${message.replace('missing_env:', '')}` : message,
      latencyMs: Math.round(performance.now() - started),
      drilldownUrl: null,
      checkedAt: new Date().toISOString(),
    });
  }
}

async function plannedRow(name, question, detail, drilldownUrl = null) {
  rows.push({
    name,
    question,
    status: 'skip',
    detail: `not-ready: ${detail}`,
    latencyMs: 0,
    drilldownUrl,
    checkedAt: new Date().toISOString(),
  });
}

async function optionalCheck(fn) {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('missing_env:')) {
      return { ok: null, skipped: true, detail: `skip(${message.replace('missing_env:', '')})` };
    }
    return { ok: false, detail: message };
  }
}

function combined(parts, drilldownUrl) {
  const failures = parts.filter((part) => part.ok === false || part.status === 'fail');
  const skipped = parts.filter((part) => part.skipped || part.ok === null || part.status === 'warn');
  return {
    status: failures.length ? 'fail' : skipped.length ? 'warn' : 'pass',
    detail: parts.map((part) => part.detail).join('; '),
    drilldownUrl,
  };
}

function simple(ok, detail, drilldownUrl, latencyMs) {
  return { status: ok ? 'pass' : 'fail', detail, drilldownUrl, latencyMs };
}

async function statusPage(url) {
  const response = await http(url);
  const body = json(await response.text());
  const indicator = body?.status?.indicator ?? 'unknown';
  return {
    ok: response.ok && indicator === 'none',
    detail: `status=${indicator}`,
  };
}

async function vercelDeployments(projectId, token, teamId) {
  const params = new URLSearchParams({ projectId, target: 'production', limit: '1' });
  if (teamId) params.set('teamId', teamId);
  return http(`https://api.vercel.com/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function latestWorkflow(token, workflowFile, label) {
  const body = await githubJson(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`, token);
  const run = body.workflow_runs?.[0];
  if (!run) return { ok: false, detail: `${label}=missing` };
  if (run.status !== 'completed') {
    return { status: 'warn', detail: `${label}=${run.status}` };
  }
  return {
    ok: run.conclusion === 'success',
    detail: `${label}=${run.conclusion ?? 'unknown'}`,
  };
}

async function edgePreflight(functionName) {
  const supabaseUrl = env('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = env('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const response = await http(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'OPTIONS',
    headers: {
      apikey: anonKey,
      Origin: baseUrl,
      'Access-Control-Request-Method': 'POST',
    },
  });
  return {
    ok: response.ok,
    detail: `${functionName}=${response.status}`,
  };
}

async function edgeExpectedStatus(functionName, { method, expectedStatus, detailPrefix }) {
  const supabaseUrl = env('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = env('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const response = await http(`${supabaseUrl}/functions/v1/${functionName}`, {
    method,
    headers: {
      apikey: anonKey,
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify({}),
  });
  return {
    ok: response.status === expectedStatus,
    detail: `${detailPrefix}=${response.status}${response.status === expectedStatus ? ':expected' : ''}`,
  };
}

async function stripePrice(secret, label, priceId) {
  const response = await http(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = json(await response.text());
  return {
    ok: response.ok && body?.active === true,
    detail: `${label}=${response.status}${body?.active === false ? ':inactive' : ''}`,
  };
}

function secretShape(name, value, { minLength = 1 } = {}) {
  return {
    ok: typeof value === 'string' && value.length >= minLength,
    detail: `${name}=${typeof value === 'string' && value.length >= minLength ? 'present' : 'invalid'}`,
  };
}

async function http(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPS_HEALTH_TIMEOUT_MS || 15_000));
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    response.ms = Math.round(performance.now() - started);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function githubJson(pathname, token) {
  const response = await http(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`github=${response.status}`);
  return JSON.parse(text);
}

function env(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`missing_env:${[name, ...aliases].join('|')}`);
}

function normalizeBearerToken(value) {
  return value.trim().replace(/^Bearer\s+/i, '');
}

function optionalEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  return null;
}

function latestAgeDays(history) {
  if (!Array.isArray(history) || history.length === 0) return Number.POSITIVE_INFINITY;
  const latest = history[history.length - 1]?.timestamp;
  if (!latest) return Number.POSITIVE_INFINITY;
  return (Date.now() - Date.parse(latest)) / 86_400_000;
}

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarize(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, skip: 0 });
}

function renderMarkdown({ generatedAt, baseUrl, repo, runContext, summary, checks }) {
  const hardFailure = summary.fail > 0;
  const credentialLimited = runContext !== 'GitHub Actions' && checks.some((check) => /missing=|skip\(/.test(check.detail));
  const lines = [
    '# SpeakSharp Ops Health',
    '',
    `Generated: ${generatedAt}`,
    `Target: ${baseUrl}`,
    `Repository: ${repo}`,
    `Run context: ${runContext}`,
    '',
    `Verdict: ${hardFailure ? 'ACTION REQUIRED' : 'NO HARD FAILURES IN CHECKS THAT RAN'}`,
    `Coverage: ${summary.pass} ok / ${summary.warn} review / ${summary.fail} fail / ${summary.skip} not checked`,
  ];

  if (credentialLimited) {
    lines.push(
      '',
      '> This local run is not authoritative for vendor credentials because GitHub Actions secrets are not available in the local shell. Use the GitHub Ops Health workflow for the secret-backed view.'
    );
  }

  lines.push(
    '',
    '| Area | Status | Meaning | Evidence | Next Action | Drill-down |',
    '|---|---|---|---|---|---|',
  );

  for (const check of checks) {
    lines.push([
      esc(check.name),
      esc(statusBadge(check)),
      esc(check.question),
      esc(check.detail),
      esc(nextAction(check, runContext)),
      check.drilldownUrl ? `[Open](${check.drilldownUrl})` : '',
    ].join(' | '));
  }

  lines.push(
    '',
    '## How To Read This',
    '',
    '- `OK` means the check ran and passed.',
    '- `REVIEW` means no hard outage was proven, but freshness, optional credentials, or external status needs attention.',
    '- `FAIL` means a launch-relevant dependency or workflow is red.',
    '- `NOT READY` means the check could not produce a useful signal yet, usually because this run lacks credentials or the integration is intentionally deferred.',
    '',
    '> Keep this dashboard simple. It is an early warning board, not a replacement for vendor dashboards.'
  );
  return `${lines.join('\n')}\n`;
}

function renderPublicSummary({ generatedAt, baseUrl, repo, runContext, summary, checks }) {
  return {
    generatedAt,
    baseUrl,
    repo,
    runContext,
    summary,
    verdict: summary.fail > 0 ? 'ACTION REQUIRED' : 'NO HARD FAILURES',
    checks: checks.map((check) => ({
      name: check.name,
      status: check.status,
      label: verdictLabel(check),
      icon: statusIcon(check),
      question: check.question,
      evidence: check.detail,
      nextAction: nextAction(check, runContext),
      latencyMs: check.latencyMs,
      checkedAt: check.checkedAt,
      drilldownUrl: check.drilldownUrl,
    })),
  };
}

function verdictLabel(check) {
  if (check.status === 'pass') return 'OK';
  if (check.status === 'fail') return 'DOWN';
  if (check.status === 'skip') return 'NOT READY';
  return 'REVIEW';
}

function statusBadge(check) {
  const label = verdictLabel(check);
  return `${statusIcon(check)} ${label}`;
}

function statusIcon(check) {
  if (check.status === 'pass') return '🟢';
  if (check.status === 'fail') return '🔴';
  if (check.status === 'skip') return '🚧';
  return '🟡';
}

function nextAction(check, runContext) {
  if (check.status === 'pass') return 'No action.';
  if (/stale\/missing=/.test(check.detail)) return 'Run or refresh the named benchmark before making benchmark claims.';
  if (/missing=|skip\(/.test(check.detail)) {
    return runContext === 'GitHub Actions'
      ? 'Wire the expected GitHub secret name or update the check to the real secret name.'
      : 'Run the GitHub Ops Health workflow for the secret-backed result.';
  }
  if (check.name === 'GitHub') return 'Open Actions and fix the red release workflow before tester release.';
  if (check.status === 'fail') return 'Open the vendor dashboard or drill-down and resolve before release.';
  return 'Review before release.';
}

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
