#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = process.env.GITHUB_REPOSITORY || 'relativityE/speaksharp';
const baseUrl = (process.env.BASE_URL || 'https://speaksharp-public.vercel.app').replace(/\/$/, '');
const outputDir = process.env.OPS_HEALTH_OUTPUT_DIR || 'ops-health';
const benchmarksPath = process.env.STT_BENCHMARKS_PATH || 'tests/STT_BENCHMARKS.json';
const generatedAt = new Date().toISOString();

const rows = [];

await row('App', 'Can users reach SpeakSharp?', async () => {
  const app = await http(baseUrl);
  return simple(app.ok, `Production app HTTP ${app.status}`, baseUrl, app.ms);
});

await row('Vercel', 'Is hosting/deploy infrastructure healthy?', async () => {
  const platform = await statusPage('https://www.vercel-status.com/api/v2/summary.json');
  const deployment = await optionalCheck(async () => {
    const token = env('VERCEL_TOKEN');
    const projectId = env('VERCEL_PROJECT_ID', ['VERCEL_PROJECT']);
    const teamId = optionalEnv('VERCEL_TEAM_ID', ['VERCEL_ORG_ID']);
    const params = new URLSearchParams({ projectId, target: 'production', limit: '1' });
    if (teamId) params.set('teamId', teamId);
    const response = await http(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = json(await response.text());
    return {
      ok: response.ok && body?.deployments?.[0]?.state === 'READY',
      detail: body?.deployments?.[0]?.state ? `deploy=${body.deployments[0].state}` : `deploy-http=${response.status}`,
    };
  });
  return combined([platform, deployment], 'https://vercel.com/dashboard');
});

await row('Supabase', 'Are auth, REST, and Edge Function entrypoints reachable?', async () => {
  const supabaseUrl = env('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = env('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const auth = await http(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const edge = await http(`${supabaseUrl}/functions/v1/check-usage-limit`, {
    method: 'OPTIONS',
    headers: {
      apikey: anonKey,
      Origin: baseUrl,
      'Access-Control-Request-Method': 'POST',
    },
  });
  const platform = await statusPage('https://status.supabase.com/api/v2/summary.json');
  return combined([
    { ok: auth.ok, detail: `auth=${auth.status}` },
    { ok: edge.ok, detail: `edge=${edge.status}` },
    platform,
  ], 'https://supabase.com/dashboard');
});

await row('STT/AI Providers', 'Are paid provider APIs reachable?', async () => {
  const assembly = await optionalCheck(async () => {
    const response = await http('https://api.assemblyai.com/v2/transcript', {
      headers: { authorization: env('ASSEMBLYAI_API_KEY') },
    });
    return { ok: response.ok, detail: `assemblyai=${response.status}` };
  });
  const gemini = await optionalCheck(async () => {
    const key = env('GEMINI_API_KEY', ['GOOGLE_API_KEY']);
    const response = await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    return { ok: response.ok, detail: `gemini=${response.status}` };
  });
  return combined([assembly, gemini], 'https://www.assemblyai.com/dashboard/');
});

await row('Billing', 'Are Stripe API and webhook config healthy?', async () => {
  const stripe = await http('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` },
  });
  const webhookSecret = env('STRIPE_WEBHOOK_SECRET');
  return combined([
    { ok: stripe.ok, detail: `stripe=${stripe.status}` },
    { ok: /^whsec_/.test(webhookSecret), detail: /^whsec_/.test(webhookSecret) ? 'webhook=valid' : 'webhook=invalid' },
  ], 'https://dashboard.stripe.com/');
});

await row('Observability', 'Can we query Sentry and PostHog?', async () => {
  const sentry = await optionalCheck(async () => {
    const apiBase = (process.env.SENTRY_API_BASE || 'https://sentry.io/api/0').replace(/\/$/, '');
    const org = env('SENTRY_ORG');
    const project = env('SENTRY_PROJECT');
    const response = await http(`${apiBase}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/`, {
      headers: { Authorization: `Bearer ${env('SENTRY_AUTH_TOKEN')}` },
    });
    return { ok: response.ok, detail: `sentry=${response.status}` };
  });
  const posthog = await optionalCheck(async () => {
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
    return { ok: response.ok, detail: `posthog=${response.status}` };
  });
  return combined([sentry, posthog], 'https://sentry.io/');
});

await row('GitHub', 'Are release workflows green?', async () => {
  const token = env('GITHUB_TOKEN', ['GH_TOKEN']);
  const checks = await Promise.all([
    latestWorkflow(token, 'rc-gates.yml', 'rc'),
    latestWorkflow(token, 'ci.yml', 'ci'),
    latestWorkflow(token, 'canary.yml', 'canary'),
    latestWorkflow(token, 'ops-health.yml', 'ops'),
  ]);
  return combined(checks, `https://github.com/${repo}/actions`);
});

await row('Benchmarks', 'Are controlled STT benchmark stats fresh?', async () => {
  const raw = await fs.readFile(benchmarksPath, 'utf8');
  const data = JSON.parse(raw);
  const staleDays = Number(process.env.OPS_HEALTH_BENCHMARK_STALE_DAYS || 14);
  const targets = [
    ['cloud', data.engines?.Cloud?.history],
    ['private-v2', data.engines?.Private?.cpu?.history],
    ['private-v4', data.engines?.Private?.v4?.history],
  ];
  const stale = targets
    .map(([name, history]) => ({ name, age: latestAgeDays(history) }))
    .filter((entry) => !Number.isFinite(entry.age) || entry.age > staleDays);
  return {
    status: stale.length ? 'warn' : 'pass',
    detail: stale.length ? `stale/missing=${stale.map((entry) => entry.name).join(',')}` : `fresh<=${staleDays}d`,
    drilldownUrl: `https://github.com/${repo}/actions/workflows/benchmarks.yml`,
  };
});

const summary = summarize(rows);
const payload = { generatedAt, baseUrl, repo, summary, checks: rows };
const markdown = renderMarkdown(payload);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'ops-health.json'), JSON.stringify(payload, null, 2));
await fs.writeFile(path.join(outputDir, 'ops-health.md'), markdown);
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

function renderMarkdown({ generatedAt, baseUrl, repo, summary, checks }) {
  const lines = [
    '# SpeakSharp Ops Health',
    '',
    `Generated: ${generatedAt}`,
    `Target: ${baseUrl}`,
    `Repository: ${repo}`,
    '',
    `Summary: ${summary.pass} pass / ${summary.warn} warn / ${summary.fail} fail / ${summary.skip} skip`,
    '',
    '| Status | Area | What It Answers | Detail | Drill-down |',
    '|---|---|---|---|---|',
  ];

  for (const check of checks) {
    lines.push([
      check.status.toUpperCase(),
      esc(check.name),
      esc(check.question),
      esc(check.detail),
      check.drilldownUrl ? `[Open](${check.drilldownUrl})` : '',
    ].join(' | '));
  }

  lines.push('', '> Keep this dashboard simple. It is an early warning board, not a replacement for vendor dashboards.');
  return `${lines.join('\n')}\n`;
}

function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
