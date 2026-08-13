#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { evaluateGithubRow } from './lib/github-ops-row.mjs';
import { summarize, renderMarkdown, renderPublicSummary, exitCodeForRows } from './lib/ops-health-report.mjs';

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
    // Unauthenticated remains 401; authenticated customer denial/no-provider-call is covered by
    // the Edge contract tests and deployed canary.
    expectedStatus: 401,
    detailPrefix: 'assemblyai-token',
  });
  return combined([
    { ok: auth.ok, detail: `auth=${auth.status}` },
    usageLimitEdge,
    tokenEdge,
  ], 'https://supabase.com/dashboard');
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
  // Resilient, labeled, hard-deadline-bounded (see lib/github-ops-row.mjs + lib/github-ops-fetch.mjs).
  return evaluateGithubRow(repo, token);
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

process.exitCode = exitCodeForRows(rows);

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
