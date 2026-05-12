import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { captureSentryEvent, createSentryEventId } from '../_shared/sentry.ts';

type SmokeRequest = {
  proofId?: string
}

export async function handler(req: Request) {
  const headers = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, headers);
  }

  const configuredSecret = Deno.env.get('OBSERVABILITY_SMOKE_SECRET');
  const providedSecret = req.headers.get('x-observability-smoke-secret');

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return json({ error: 'not_found' }, 404, headers);
  }

  const sentryDsn = Deno.env.get('SENTRY_DSN');
  if (!sentryDsn) {
    return json({ error: 'sentry_dsn_missing' }, 503, headers);
  }

  const body = await readJson(req);
  const proofId = sanitizeProofId(body.proofId);
  const eventId = createSentryEventId();

  const result = await captureSentryEvent(sentryDsn, {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    message: `SpeakSharp edge observability smoke ${proofId}`,
    environment: 'production',
    tags: {
      proof_id: proofId,
      surface: 'edge',
      component: 'observability-smoke',
    },
    extra: {
      proof_id: proofId,
      source: 'supabase-edge-function',
    },
  });

  return json({
    ok: true,
    proofId,
    eventId: result.eventId,
    ingestStatus: result.status,
  }, 200, headers);
}

async function readJson(req: Request): Promise<SmokeRequest> {
  try {
    return await req.json() as SmokeRequest;
  } catch {
    return {};
  }
}

function sanitizeProofId(value: unknown) {
  if (typeof value === 'string' && /^[a-zA-Z0-9._:-]{8,120}$/.test(value)) {
    return value;
  }

  return `edge-${Date.now()}`;
}

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}

if (import.meta.main) {
  serve(handler);
}
