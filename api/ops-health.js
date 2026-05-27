const DEFAULT_REPO = 'relativityE/speaksharp';
const DEFAULT_BASE_URL = 'https://speaksharp-public.vercel.app';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const startedAt = Date.now();
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const baseUrl = normalizeBaseUrl(env.BASE_URL || env.VERCEL_PROJECT_PRODUCTION_URL || DEFAULT_BASE_URL);
  const checks = [];

  await row(checks, 'App', 'Can users reach SpeakSharp?', async () => {
    const app = await http(baseUrl);
    return simple(app.ok, `Production app HTTP ${app.status}`, baseUrl, app.ms);
  });

  await row(checks, 'Vercel API', 'Can we read the latest production deployment?', async () => {
    const token = requiredEnv(env, 'VERCEL_ACCESS_TOKEN');
    const projectId = requiredEnv(env, 'VERCEL_PROJECT_ID');
    const teamId = optionalEnv(env, 'VERCEL_TEAM_ID', ['VERCEL_ORG_ID']);
    const result = await vercelDeployments({ token, projectId, teamId });
    return {
      status: result.ready ? (result.teamScopeRejected ? 'warn' : 'pass') : 'fail',
      evidence: result.detail,
      drilldownUrl: 'https://vercel.com/dashboard',
    };
  });

  await row(checks, 'Supabase API', 'Can clients reach Auth and SpeakSharp Edge Functions?', async () => {
    const supabaseUrl = requiredEnv(env, 'SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
    const anonKey = requiredEnv(env, 'SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
    const auth = await http(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    const usage = await edgePreflight({ env, baseUrl, functionName: 'check-usage-limit' });
    const token = await edgeExpectedStatus({
      env,
      baseUrl,
      functionName: 'assemblyai-token',
      expectedStatus: 401,
      detailPrefix: 'assemblyai-token',
    });
    return combined([
      { ok: auth.ok, evidence: `auth=${auth.status}` },
      usage,
      token,
    ], 'https://supabase.com/dashboard');
  });

  await row(checks, 'AssemblyAI API', 'Can Cloud STT provider credentials reach AssemblyAI?', async () => {
    const provider = await http('https://api.assemblyai.com/v2/transcript', {
      headers: { authorization: requiredEnv(env, 'ASSEMBLYAI_API_KEY') },
    });
    return simple(provider.ok, `transcript-api=${provider.status}`, 'https://www.assemblyai.com/dashboard/', provider.ms);
  });

  await row(checks, 'Gemini API', 'Can AI suggestions provider credentials reach Gemini?', async () => {
    const key = requiredEnv(env, 'GEMINI_API_KEY', ['GOOGLE_API_KEY']);
    const gemini = await http(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    return simple(gemini.ok, `models=${gemini.status}`, 'https://aistudio.google.com/', gemini.ms);
  });

  await row(checks, 'Stripe API', 'Can billing credentials reach Stripe and read product prices?', async () => {
    const secret = requiredEnv(env, 'STRIPE_SECRET_KEY');
    const balance = await http('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const basic = await stripePrice(secret, 'basic', requiredEnv(env, 'STRIPE_BASIC_PRICE_ID', ['VITE_STRIPE_BASIC_PRICE_ID']));
    const pro = await stripePrice(secret, 'pro', requiredEnv(env, 'STRIPE_PRO_PRICE_ID', ['VITE_STRIPE_PRO_PRICE_ID', 'VITE_STRIPE_PRICE_ID']));
    return combined([
      { ok: balance.ok, evidence: `balance=${balance.status}` },
      basic,
      pro,
    ], 'https://dashboard.stripe.com/');
  });

  await row(checks, 'Sentry API', 'Can we query Sentry project health?', async () => {
    const apiBase = (env.SENTRY_API_BASE || 'https://sentry.io/api/0').replace(/\/$/, '');
    const org = requiredEnv(env, 'SENTRY_ORG');
    const project = requiredEnv(env, 'SENTRY_PROJECT');
    const sentry = await http(`${apiBase}/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/`, {
      headers: { Authorization: `Bearer ${requiredEnv(env, 'SENTRY_AUTH_TOKEN')}` },
    });
    return simple(sentry.ok, `project=${sentry.status}`, 'https://sentry.io/', sentry.ms);
  });

  await row(checks, 'PostHog API', 'Can we query PostHog analytics?', async () => {
    const apiHost = (env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
    const projectId = requiredEnv(env, 'POSTHOG_PROJECT_ID');
    const posthog = await http(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${requiredEnv(env, 'POSTHOG_PERSONAL_API_KEY')}`,
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: 'SELECT 1' }, name: 'SpeakSharp ops health query' }),
    });
    return simple(posthog.ok, `query=${posthog.status}`, 'https://us.posthog.com/', posthog.ms);
  });

  await row(checks, 'GitHub API', 'Can we query repository metadata and release workflows?', async () => {
    const token = requiredEnv(env, 'GITHUB_TOKEN', ['GH_TOKEN', 'GH_PAT']);
    const repoMeta = await githubJson(`/repos/${repo}`, token);
    const rc = await latestWorkflow(token, repo, 'rc-gates.yml', 'rc');
    const ci = await latestWorkflow(token, repo, 'ci.yml', 'ci');
    const canary = await latestWorkflow(token, repo, 'canary.yml', 'canary');
    return combined([
      { ok: repoMeta?.full_name === repo, evidence: `repo=${repoMeta?.full_name ?? 'unknown'}; private=${repoMeta?.private === true}` },
      rc,
      ci,
      canary,
    ], `https://github.com/${repo}/actions`);
  });

  const summary = summarize(checks);
  response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
  return response.status(200).json({
    generatedAt: new Date().toISOString(),
    baseUrl,
    repo,
    runContext: 'Vercel serverless',
    durationMs: Date.now() - startedAt,
    summary,
    verdict: summary.fail > 0 ? 'ACTION REQUIRED' : 'NO HARD FAILURES',
    checks,
  });
}

async function row(checks, name, question, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    checks.push(normalizeCheck({
      name,
      question,
      latencyMs: result.latencyMs ?? Date.now() - started,
      checkedAt: new Date().toISOString(),
      ...result,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(normalizeCheck({
      name,
      question,
      status: message.startsWith('missing_env:') ? 'skip' : 'fail',
      evidence: message.startsWith('missing_env:') ? `missing=${message.replace('missing_env:', '')}` : message,
      nextAction: message.startsWith('missing_env:')
        ? 'Wire the expected Vercel environment variable or update the check to the real variable name.'
        : 'Open the vendor dashboard and resolve before release.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }));
  }
}

function normalizeCheck(check) {
  return {
    name: check.name,
    status: check.status,
    label: labelFor(check.status),
    icon: iconFor(check.status),
    question: check.question,
    evidence: check.evidence,
    nextAction: check.nextAction ?? nextActionFor(check),
    latencyMs: check.latencyMs,
    checkedAt: check.checkedAt,
    drilldownUrl: check.drilldownUrl ?? null,
  };
}

function labelFor(status) {
  if (status === 'pass') return 'OK';
  if (status === 'fail') return 'DOWN';
  if (status === 'skip') return 'NOT READY';
  return 'REVIEW';
}

function iconFor(status) {
  if (status === 'pass') return '🟢';
  if (status === 'fail') return '🔴';
  if (status === 'skip') return '🚧';
  return '🟡';
}

function nextActionFor(check) {
  if (check.status === 'pass') return 'No action.';
  if (/missing=/.test(check.evidence ?? '')) return 'Wire the expected environment variable.';
  if (check.name === 'GitHub API') return 'Open Actions and fix red release workflows.';
  if (check.status === 'fail') return 'Open the vendor dashboard and resolve before release.';
  return 'Review before release.';
}

function combined(parts, drilldownUrl) {
  const failures = parts.filter((part) => part.ok === false || part.status === 'fail');
  const review = parts.filter((part) => part.status === 'warn' || part.ok === null);
  return {
    status: failures.length ? 'fail' : review.length ? 'warn' : 'pass',
    evidence: parts.map((part) => part.evidence).join('; '),
    drilldownUrl,
  };
}

function simple(ok, evidence, drilldownUrl, latencyMs) {
  return { status: ok ? 'pass' : 'fail', evidence, drilldownUrl, latencyMs };
}

async function http(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPS_HEALTH_TIMEOUT_MS || 15000));
  const started = Date.now();
  try {
    const result = await fetch(url, { ...init, signal: controller.signal });
    result.ms = Date.now() - started;
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function vercelDeployments({ token, projectId, teamId }) {
  let response = await vercelDeploymentFetch({ token, projectId, teamId });
  let teamScopeRejected = false;
  if (teamId && response.status === 403) {
    teamScopeRejected = true;
    response = await vercelDeploymentFetch({ token, projectId, teamId: null });
  }
  const body = safeJson(await response.text());
  const deployment = body?.deployments?.[0];
  return {
    ready: response.ok && deployment?.state === 'READY',
    teamScopeRejected,
    detail: deployment?.state
      ? `latest=${deployment.state}; url=${deployment.url ?? 'unknown'}${teamScopeRejected ? '; teamScope=403; used=unscoped' : ''}`
      : `http=${response.status}${teamScopeRejected ? '; teamScope=403; unscoped-retry-failed' : ''}`,
  };
}

function vercelDeploymentFetch({ token, projectId, teamId }) {
  const params = new URLSearchParams({ projectId, target: 'production', limit: '1' });
  if (teamId) params.set('teamId', teamId);
  return http(`https://api.vercel.com/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function edgePreflight({ env, baseUrl, functionName }) {
  const supabaseUrl = requiredEnv(env, 'SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = requiredEnv(env, 'SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const result = await http(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'OPTIONS',
    headers: {
      apikey: anonKey,
      Origin: baseUrl,
      'Access-Control-Request-Method': 'POST',
    },
  });
  return { ok: result.ok, evidence: `${functionName}=${result.status}` };
}

async function edgeExpectedStatus({ env, baseUrl, functionName, expectedStatus, detailPrefix }) {
  const supabaseUrl = requiredEnv(env, 'SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = requiredEnv(env, 'SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);
  const result = await http(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return {
    ok: result.status === expectedStatus,
    evidence: `${detailPrefix}=${result.status}${result.status === expectedStatus ? ':expected' : ''}`,
  };
}

async function stripePrice(secret, label, priceId) {
  const result = await http(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = safeJson(await result.text());
  return {
    ok: result.ok && body?.active === true,
    evidence: `${label}=${result.status}${body?.active === false ? ':inactive' : ''}`,
  };
}

async function githubJson(pathname, token) {
  const result = await http(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`github=${result.status}`);
  return JSON.parse(text);
}

async function latestWorkflow(token, repo, workflowFile, label) {
  const body = await githubJson(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`, token);
  const run = body.workflow_runs?.[0];
  if (!run) return { ok: false, evidence: `${label}=missing` };
  if (run.status !== 'completed') return { status: 'warn', evidence: `${label}=${run.status}` };
  return { ok: run.conclusion === 'success', evidence: `${label}=${run.conclusion ?? 'unknown'}` };
}

function summarize(checks) {
  return checks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, skip: 0 });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function requiredEnv(env, name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (env[key]) return env[key];
  }
  throw new Error(`missing_env:${[name, ...aliases].join('|')}`);
}

function optionalEnv(env, name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (env[key]) return env[key];
  }
  return null;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || DEFAULT_BASE_URL).replace(/\/$/, '');
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}
