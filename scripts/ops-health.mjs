#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const repo = process.env.GITHUB_REPOSITORY || 'relativityE/speaksharp';
const baseUrl = (process.env.BASE_URL || 'https://speaksharp-public.vercel.app').replace(/\/$/, '');
const outputDir = process.env.OPS_HEALTH_OUTPUT_DIR || 'ops-health';
const generatedAt = new Date().toISOString();

const checks = [];

await addCheck('SpeakSharp web app', 'app', async () => {
  const response = await timedFetch(baseUrl, { method: 'GET' });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: baseUrl,
  };
});

await addCheck('Supabase REST/Auth edge', 'supabase', async () => {
  const supabaseUrl = requireEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']);
  const anonKey = requireEnv('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const response = await timedFetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `Auth settings HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: 'https://supabase.com/dashboard',
  };
});

await addCheck('AssemblyAI API credential', 'assemblyai', async () => {
  const apiKey = requireEnv('ASSEMBLYAI_API_KEY');
  const response = await timedFetch('https://api.assemblyai.com/v2/transcript', {
    headers: { authorization: apiKey },
  });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `Transcript list HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: 'https://www.assemblyai.com/dashboard/',
  };
});

await addCheck('Stripe API credential', 'stripe', async () => {
  const secretKey = requireEnv('STRIPE_SECRET_KEY');
  const response = await timedFetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `Balance HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: 'https://dashboard.stripe.com/',
  };
});

await addCheck('Stripe webhook secret configured', 'stripe', async () => {
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
  return {
    status: /^whsec_/.test(webhookSecret) ? 'pass' : 'fail',
    detail: /^whsec_/.test(webhookSecret)
      ? 'Webhook signing secret shape is valid'
      : 'Webhook signing secret is missing or malformed',
    drilldownUrl: 'https://dashboard.stripe.com/webhooks',
  };
});

await addCheck('GitHub RC Gate 3 latest run', 'github', async () => {
  const token = requireEnv('GITHUB_TOKEN', ['GH_TOKEN']);
  const runs = await githubJson(`/repos/${repo}/actions/workflows/rc-gates.yml/runs?per_page=10`, token);
  const gate3 = runs.workflow_runs?.find((run) =>
    run.event === 'workflow_dispatch' &&
    (run.display_title === 'Release Candidate Gates' || run.name === 'Release Candidate Gates')
  );
  if (!gate3) {
    return {
      status: 'warn',
      detail: 'No recent RC gate run found',
      drilldownUrl: `https://github.com/${repo}/actions/workflows/rc-gates.yml`,
    };
  }

  return {
    status: gate3.status === 'completed' && gate3.conclusion === 'success' ? 'pass' : 'warn',
    detail: `${gate3.status}/${gate3.conclusion ?? 'pending'} run ${gate3.id}`,
    drilldownUrl: gate3.html_url,
  };
});

await addCheck('Sentry API access', 'sentry', async () => {
  const token = requireEnv('SENTRY_AUTH_TOKEN');
  const org = requireEnv('SENTRY_ORG');
  const project = requireEnv('SENTRY_PROJECT');
  const apiBase = (process.env.SENTRY_API_BASE || 'https://sentry.io/api/0').replace(/\/$/, '');
  const response = await timedFetch(`${apiBase}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `Project read HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: `https://sentry.io/organizations/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/`,
  };
});

await addCheck('PostHog API access', 'posthog', async () => {
  const token = requireEnv('POSTHOG_PERSONAL_API_KEY');
  const projectId = requireEnv('POSTHOG_PROJECT_ID');
  const apiHost = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
  const response = await timedFetch(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.ok ? 'pass' : 'fail',
    detail: `Project read HTTP ${response.status}`,
    latencyMs: response.latencyMs,
    drilldownUrl: `${apiHost}/project/${encodeURIComponent(projectId)}`,
  };
});

const summary = summarize(checks);
const payload = {
  generatedAt,
  baseUrl,
  repo,
  summary,
  checks,
};
const markdown = renderMarkdown(payload);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'ops-health.json'), JSON.stringify(payload, null, 2));
await fs.writeFile(path.join(outputDir, 'ops-health.md'), markdown);

console.log(markdown);

if (summary.fail > 0) {
  process.exitCode = 1;
}

async function addCheck(name, category, fn) {
  const startedAt = performance.now();
  try {
    const result = await fn();
    checks.push({
      name,
      category,
      status: result.status,
      detail: result.detail,
      latencyMs: result.latencyMs ?? Math.round(performance.now() - startedAt),
      drilldownUrl: result.drilldownUrl ?? null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name,
      category,
      status: message.startsWith('missing_env:') ? 'skip' : 'fail',
      detail: message.startsWith('missing_env:')
        ? `Missing ${message.replace('missing_env:', '')}`
        : message,
      latencyMs: Math.round(performance.now() - startedAt),
      drilldownUrl: null,
      checkedAt: new Date().toISOString(),
    });
  }
}

async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPS_HEALTH_TIMEOUT_MS || 15_000));
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    response.latencyMs = Math.round(performance.now() - startedAt);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function githubJson(pathname, token) {
  const response = await timedFetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function requireEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`missing_env:${[name, ...aliases].join(' or ')}`);
}

function summarize(rows) {
  return rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
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
    '| Status | Check | Category | Detail | Latency | Drill-down |',
    '|---|---|---|---|---:|---|',
  ];

  for (const check of checks) {
    lines.push([
      badge(check.status),
      escapeCell(check.name),
      escapeCell(check.category),
      escapeCell(check.detail),
      check.latencyMs == null ? '' : `${check.latencyMs}ms`,
      check.drilldownUrl ? `[Open](${check.drilldownUrl})` : '',
    ].join(' | '));
  }

  lines.push('', '> This dashboard stores only high-level health and drill-down links. It must not write API keys, user data, transcripts, or raw vendor payloads.');
  return `${lines.join('\n')}\n`;
}

function badge(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  if (status === 'skip') return 'SKIP';
  return 'FAIL';
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
