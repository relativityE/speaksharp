#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const target = getArg('--target') ?? 'all';
const proofId = getArg('--proof-id') ?? `launch-${Date.now()}-${randomUUID().slice(0, 8)}`;

const results = {};

if (target === 'all' || target === 'frontend-sentry') {
  results.frontendSentry = await proveFrontendSentry();
}

if (target === 'all' || target === 'edge-sentry') {
  results.edgeSentry = await proveEdgeSentry();
}

if (target === 'all' || target === 'posthog') {
  results.posthog = await provePostHog();
}

console.log(`LIVE_OBSERVABILITY_API_EVIDENCE ${JSON.stringify({ proofId, results })}`);

async function proveFrontendSentry() {
  const dsn = requireEnv('SENTRY_DSN', ['VITE_SENTRY_DSN']);
  requireEnv('SENTRY_AUTH_TOKEN');
  requireEnv('SENTRY_ORG');
  requireEnv('SENTRY_PROJECT');

  const eventId = createSentryEventId();
  await sendSentryEnvelope(dsn, {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    message: `SpeakSharp frontend observability smoke ${proofId}`,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    tags: {
      proof_id: proofId,
      surface: 'frontend',
      component: 'live-observability-proof',
    },
    extra: {
      proof_id: proofId,
      source: 'github-api-smoke',
    },
  });

  const event = await pollSentryEvent(eventId, 'frontend');
  return {
    eventId,
    apiConfirmed: true,
    title: event.title ?? event.message ?? null,
    project: event.projectSlug ?? process.env.SENTRY_PROJECT,
  };
}

async function proveEdgeSentry() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const smokeSecret = requireEnv('OBSERVABILITY_SMOKE_SECRET');
  requireEnv('SENTRY_AUTH_TOKEN');
  requireEnv('SENTRY_ORG');
  requireEnv('SENTRY_PROJECT');

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/observability-smoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-observability-smoke-secret': smokeSecret,
    },
    body: JSON.stringify({ proofId }),
  });

  const bodyText = await response.text();
  const body = parseJson(bodyText);
  if (!response.ok || !body?.eventId) {
    throw new Error(`Edge Sentry smoke failed HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const event = await pollSentryEvent(body.eventId, 'edge');
  return {
    eventId: body.eventId,
    apiConfirmed: true,
    title: event.title ?? event.message ?? null,
    project: event.projectSlug ?? process.env.SENTRY_PROJECT,
  };
}

async function provePostHog() {
  const projectApiKey = requireEnv('POSTHOG_PROJECT_API_KEY', ['VITE_POSTHOG_KEY']);
  const personalApiKey = requireEnv('POSTHOG_PERSONAL_API_KEY');
  const projectId = requireEnv('POSTHOG_PROJECT_ID');
  const ingestHost = (process.env.POSTHOG_INGEST_HOST ?? process.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, '');
  const apiHost = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');
  const distinctId = `launch-observability-${proofId}`;

  const captureResponse = await fetch(`${ingestHost}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: projectApiKey,
      event: 'launch_observability_smoke',
      distinct_id: distinctId,
      properties: {
        proof_id: proofId,
        source: 'github-api-smoke',
      },
    }),
  });

  if (!captureResponse.ok) {
    const body = await captureResponse.text().catch(() => '');
    throw new Error(`PostHog capture failed HTTP ${captureResponse.status}: ${body.slice(0, 500)}`);
  }

  const row = await pollPostHogEvent({ apiHost, personalApiKey, projectId, proofId });
  return {
    event: row[0],
    distinctId: row[1],
    proofId: row[2],
    timestamp: row[3],
    apiConfirmed: true,
  };
}

async function sendSentryEnvelope(dsn, event) {
  const parsed = parseSentryDsn(dsn);
  const envelope = [
    JSON.stringify({ dsn, event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');

  const response = await fetch(parsed.envelopeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: envelope,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Sentry ingest failed HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
}

async function pollSentryEvent(eventId, expectedSurface) {
  const apiBase = (process.env.SENTRY_API_BASE ?? 'https://us.sentry.io').replace(/\/$/, '');
  const org = encodeURIComponent(process.env.SENTRY_ORG);
  const project = encodeURIComponent(process.env.SENTRY_PROJECT);
  const url = `${apiBase}/api/0/projects/${org}/${project}/events/${eventId}/`;

  return poll(async () => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) return null;
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Sentry API read failed HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const event = parseJson(bodyText);
    const tags = new Map((event.tags ?? []).map((tag) => [tag.key, tag.value]));
    if (tags.get('proof_id') !== proofId || tags.get('surface') !== expectedSurface) {
      return null;
    }

    return event;
  }, `Sentry event ${eventId}`);
}

async function pollPostHogEvent({ apiHost, personalApiKey, projectId, proofId }) {
  const safeProofId = assertSafeProofId(proofId);
  const query = `
    SELECT event, distinct_id, properties.proof_id, timestamp
    FROM events
    WHERE event = 'launch_observability_smoke'
      AND properties.proof_id = '${safeProofId}'
      AND timestamp > now() - INTERVAL 1 HOUR
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  return poll(async () => {
    const response = await fetch(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${personalApiKey}`,
      },
      body: JSON.stringify({
        query: {
          kind: 'HogQLQuery',
          query,
        },
        name: `SpeakSharp launch observability proof ${safeProofId}`,
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`PostHog API query failed HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const body = parseJson(bodyText);
    return body?.results?.[0] ?? null;
  }, `PostHog event ${proofId}`);
}

async function poll(callback, label) {
  const deadline = Date.now() + Number(process.env.OBSERVABILITY_POLL_TIMEOUT_MS ?? 120_000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(`${label} was not confirmed by provider API before timeout${lastError ? `: ${lastError.message}` : ''}`);
}

function parseSentryDsn(dsn) {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).at(-1);
  if (!projectId) throw new Error('SENTRY_DSN is missing a project id path segment');
  return { envelopeUrl: `${url.origin}/api/${projectId}/envelope/` };
}

function createSentryEventId() {
  return randomUUID().replaceAll('-', '');
}

function requireEnv(name, fallbacks = []) {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key];
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

function getArg(name) {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assertSafeProofId(value) {
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(value)) {
    throw new Error(`Unsafe proof id: ${value}`);
  }
  return value;
}
