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
  logSentryConfig('frontend', dsn, eventId);
  await sendSentryEnvelope(dsn, {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    message: `SpeakSharp frontend observability smoke ${proofId}`,
    exception: buildSyntheticException('frontend'),
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
  console.log(`OBS_SMOKE sentry readback success surface=frontend eventId=${eventId} title="${event.title ?? event.message ?? ''}"`);
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

  console.log(`OBS_SMOKE edge function target=${redactUrl(supabaseUrl)}/functions/v1/observability-smoke proofId=${proofId}`);
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

  console.log(`OBS_SMOKE edge function response status=${response.status} ingestStatus=${body.ingestStatus ?? 'unknown'} eventId=${body.eventId}`);
  const event = await pollSentryEvent(body.eventId, 'edge');
  console.log(`OBS_SMOKE sentry readback success surface=edge eventId=${body.eventId} title="${event.title ?? event.message ?? ''}"`);
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
  const apiHost = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');
  const ingestHost = (process.env.POSTHOG_INGEST_HOST ?? process.env.VITE_POSTHOG_HOST ?? apiHost).replace(/\/$/, '');
  const distinctId = `launch-observability-${proofId}`;

  console.log(`OBS_SMOKE posthog ingestHost=${redactUrl(ingestHost)} apiHost=${redactUrl(apiHost)} projectId=${projectId} proofId=${proofId}`);
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

  const captureBody = await captureResponse.text().catch(() => '');
  console.log(`OBS_SMOKE posthog capture accepted status=${captureResponse.status} body=${captureBody.slice(0, 160)}`);
  const row = await pollPostHogEvent({ apiHost, personalApiKey, projectId, proofId });
  console.log(`OBS_SMOKE posthog readback success event=${row[0]} distinctId=${row[1]} proofId=${row[2]} timestamp=${row[3]}`);
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
    console.log(`OBS_SMOKE sentry envelope rejected host=${redactUrl(parsed.envelopeUrl)} projectId=${parsed.projectId} status=${response.status} body=${body.slice(0, 500)}`);
    throw new Error(`Sentry ingest failed HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const body = await response.text().catch(() => '');
  console.log(`OBS_SMOKE sentry envelope accepted host=${redactUrl(parsed.envelopeUrl)} projectId=${parsed.projectId} status=${response.status} body=${body.slice(0, 160)}`);
}

async function pollSentryEvent(eventId, expectedSurface) {
  const apiBase = (process.env.SENTRY_API_BASE ?? 'https://us.sentry.io').replace(/\/$/, '');
  const org = encodeURIComponent(process.env.SENTRY_ORG);
  const project = encodeURIComponent(process.env.SENTRY_PROJECT);
  const url = `${apiBase}/api/0/projects/${org}/${project}/events/${eventId}/`;
  let attempts = 0;

  return poll(async () => {
    attempts += 1;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      logPollMiss('sentry', attempts, `status=404 eventId=${eventId} surface=${expectedSurface} api=${redactUrl(url)}`);
      return null;
    }
    const bodyText = await response.text();
    logApiResponse('sentry', attempts, response.status, bodyText);
    if (!response.ok) {
      throw new Error(`Sentry API read failed HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const event = parseJson(bodyText);
    const tags = new Map((event.tags ?? []).map((tag) => [tag.key, tag.value]));
    if (tags.get('proof_id') !== proofId || tags.get('surface') !== expectedSurface) {
      logPollMiss('sentry', attempts, `status=${response.status} eventId=${eventId} proofTag=${tags.get('proof_id') ?? 'missing'} surfaceTag=${tags.get('surface') ?? 'missing'}`);
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

  let attempts = 0;
  return poll(async () => {
    attempts += 1;
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
    logApiResponse('posthog', attempts, response.status, bodyText);
    if (!response.ok) {
      throw new Error(`PostHog API query failed HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const body = parseJson(bodyText);
    const row = body?.results?.[0] ?? null;
    if (!row) {
      logPollMiss('posthog', attempts, `status=${response.status} resultCount=${body?.results?.length ?? 'missing'} api=${redactUrl(apiHost)}`);
    }
    return row;
  }, `PostHog event ${proofId}`);
}

async function poll(callback, label) {
  const deadline = Date.now() + Number(process.env.OBSERVABILITY_POLL_TIMEOUT_MS ?? 120_000);
  let lastError;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      lastError = error;
      logPollError(label, attempts, error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(`${label} was not confirmed by provider API before timeout${lastError ? `: ${lastError.message}` : ''}`);
}

function parseSentryDsn(dsn) {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).at(-1);
  if (!projectId) throw new Error('SENTRY_DSN is missing a project id path segment');
  return { envelopeUrl: `${url.origin}/api/${projectId}/envelope/`, projectId };
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

function buildSyntheticException(surface) {
  return {
    values: [{
      type: 'SpeakSharpObservabilitySmoke',
      value: `Synthetic ${surface} observability readback probe ${proofId}`,
      stacktrace: {
        frames: [{
          filename: 'scripts/live-observability-proof.mjs',
          function: `prove-${surface}-observability-readback`,
          lineno: 1,
          colno: 1,
          in_app: true,
        }],
      },
    }],
  };
}

function logSentryConfig(surface, dsn, eventId) {
  const parsed = parseSentryDsn(dsn);
  const apiBase = process.env.SENTRY_API_BASE ?? 'https://us.sentry.io';
  console.log(`OBS_SMOKE sentry surface=${surface} eventId=${eventId} ingest=${redactUrl(parsed.envelopeUrl)} apiBase=${redactUrl(apiBase)} projectId=${parsed.projectId}`);
}

function logPollMiss(provider, attempts, details) {
  if (attempts === 1 || attempts % 6 === 0) {
    console.log(`OBS_SMOKE ${provider} poll miss attempt=${attempts} ${details}`);
  }
}

function logApiResponse(provider, attempts, status, bodyText) {
  if (attempts === 1 || status >= 400 || attempts % 6 === 0) {
    console.log(`OBS_SMOKE ${provider} api response attempt=${attempts} status=${status} body=${redactBody(bodyText).slice(0, 500)}`);
  }
}

function logPollError(label, attempts, error) {
  const message = error?.message ?? String(error);
  const stack = error?.stack ? String(error.stack).split('\n').slice(0, 8).join(' | ') : 'no stack';
  console.log(`OBS_SMOKE poll error label="${label}" attempt=${attempts} message="${message}" stack="${stack}"`);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/[a-f0-9]{24,}/gi, '<id>')}`;
  } catch {
    return String(value).replace(/[a-f0-9]{24,}/gi, '<id>');
  }
}

function redactBody(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
    .replace(/"api_key"\s*:\s*"[^"]+"/g, '"api_key":"<redacted>"')
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token":"<redacted>"');
}
