import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';
import { captureSentryEvent, createSentryEventId } from '../_shared/sentry.ts';

/**
 * Durable telemetry delivery worker (P0 incident foundation).
 *
 * Invariant: Supabase is authoritative; this worker only DELIVERS already-persisted session/report
 * events to PostHog. It NEVER writes product data and NEVER rolls anything back. Each run:
 *   1. reconcile_telemetry_outbox()  — repair any completed session / report missing an outbox row
 *      (called BEFORE every claim, so a trigger miss self-heals without manual intervention)
 *   2. claim_telemetry_batch()       — lease a batch (crash-safe: token + 5-min expiry)
 *   3. POST each event to PostHog with $insert_id (PostHog dedupes; safe to retry)
 *   4. mark_telemetry_result()       — sent / failed(+category); exhausted rows dead-letter
 *   5. sanitized Sentry alert on any failure / dead-letter (COUNTS + categories only — never a
 *      distinct_id, never tester content)
 *
 * Content-free by construction: the outbox holds no prose/PII columns; distinct_id is resolved
 * server-side only at send time and is NEVER logged. Secret-gated (server-to-server; no Origin).
 */

type OutboxRow = {
  id: string;
  event_type: 'session_saved' | 'report_issue_submitted';
  record_id: string;
  insert_id: string;
  event_timestamp: string;
  lease_token: string;
  attempt_count: number;
  max_attempts: number;
  data_origin: string;
  cohort_id: string | null;
  test_run_id: string | null;
  test_suite: string | null;
  client_release_sha: string | null;
  server_verified_release_sha: string | null;
  environment: string;
  backfilled: boolean;
};

export type DeliveryFailure = 'config_missing' | 'ingest_rejected' | 'transport_error' | 'unknown';

// ---- pure core (unit-tested) ----

/** Map an HTTP outcome to the outbox failure vocabulary. 4xx (client rejects the event) = permanent-ish
 * ingest_rejected; 429 + 5xx + network errors = transient transport_error (worth retrying). */
export function classifyDeliveryFailure(status: number | null): DeliveryFailure {
  if (status === null) return 'transport_error';        // network / no response
  if (status === 429 || status >= 500) return 'transport_error';
  if (status >= 400) return 'ingest_rejected';
  return 'transport_error';
}

/** Build the PostHog capture body for a replayed event. $insert_id makes PostHog dedupe; timestamp is
 * the ORIGINAL event time so replayed events land on the right day. client SHA is labeled untrusted. */
export function buildCapturePayload(args: {
  row: OutboxRow;
  distinctId: string;
  projectKey: string;
  serverVerifiedSha: string | null;
}) {
  const { row, distinctId, projectKey, serverVerifiedSha } = args;
  return {
    api_key: projectKey,
    event: row.event_type,
    distinct_id: distinctId,
    timestamp: row.event_timestamp,
    properties: {
      $insert_id: row.insert_id,
      server_replayed: true,
      data_origin: row.data_origin,
      cohort_id: row.cohort_id,
      test_run_id: row.test_run_id,
      test_suite: row.test_suite,
      environment: row.environment,
      // NOTE: browser-reported, never trusted as provenance.
      client_release_sha_untrusted: row.client_release_sha,
      server_verified_release_sha: serverVerifiedSha,
      backfilled: row.backfilled,
      outbox_attempt: row.attempt_count,
    },
  };
}

export type WorkerSummary = {
  reconciled: number;
  claimed: number;
  sent: number;
  failed: number;
  dead_lettered: number;
  failure_categories: Record<string, number>;
};

// ---- dependency-injected handler (I/O) ----

export type WorkerDeps = {
  getEnv: (k: string) => string | undefined;
  createSupabase: (url: string, key: string) => SupabaseClient;
  fetchImpl: typeof fetch;
  captureSentry: typeof captureSentryEvent;
};

const defaultDeps: WorkerDeps = {
  getEnv: (k) => Deno.env.get(k),
  createSupabase: (url, key) => createClient(url, key, { auth: { persistSession: false } }),
  fetchImpl: fetch,
  captureSentry: captureSentryEvent,
};

async function resolveDistinctId(supabase: SupabaseClient, row: OutboxRow): Promise<string | null> {
  const table = row.event_type === 'session_saved' ? 'sessions' : 'user_issue_reports';
  const { data } = await supabase.from(table).select('user_id').eq('id', row.record_id).maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

export async function handler(req: Request, deps: WorkerDeps = defaultDeps): Promise<Response> {
  // Secret-gated automation sends NO Origin, so corsGuard passes it through; a hostile browser Origin
  // is rejected here before anything else.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;
  const headers = corsHeaders(req);
  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const configuredSecret = deps.getEnv('TELEMETRY_WORKER_SECRET');
  const providedSecret = req.headers.get('x-telemetry-worker-secret');
  if (!configuredSecret || providedSecret !== configuredSecret) return json({ error: 'not_found' }, 404);

  const supabaseUrl = deps.getEnv('SUPABASE_URL');
  const serviceKey = deps.getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const projectKey = deps.getEnv('POSTHOG_PROJECT_KEY');
  const posthogHost = (deps.getEnv('POSTHOG_HOST') ?? 'https://us.i.posthog.com').replace(/\/$/, '');
  const serverVerifiedSha = deps.getEnv('TELEMETRY_WORKER_RELEASE_SHA') ?? null;
  const sentryDsn = deps.getEnv('SENTRY_DSN') ?? null;

  if (!supabaseUrl || !serviceKey) return json({ error: 'supabase_config_missing' }, 503);
  // No PostHog key → do NOT claim (claiming would burn retry attempts against a config gap).
  if (!projectKey) return json({ error: 'config_missing', detail: 'POSTHOG_PROJECT_KEY absent' }, 503);

  const supabase = deps.createSupabase(supabaseUrl, serviceKey);
  const batchSize = Number(deps.getEnv('TELEMETRY_WORKER_BATCH') ?? '100') || 100;

  // 1. reconcile before claim
  const { data: reconciledData, error: reconcileErr } = await supabase.rpc('reconcile_telemetry_outbox');
  if (reconcileErr) return json({ error: 'reconcile_failed' }, 500);
  const reconciled = Number(reconciledData ?? 0);

  // 2. claim
  const { data: rowsData, error: claimErr } = await supabase.rpc('claim_telemetry_batch', {
    p_limit: batchSize, p_worker: 'edge-telemetry-worker',
  });
  if (claimErr) return json({ error: 'claim_failed' }, 500);
  const rows = (rowsData ?? []) as OutboxRow[];

  const summary: WorkerSummary = { reconciled, claimed: rows.length, sent: 0, failed: 0, dead_lettered: 0, failure_categories: {} };
  const bumpFailure = (cat: DeliveryFailure) => { summary.failure_categories[cat] = (summary.failure_categories[cat] ?? 0) + 1; };

  const markFailed = async (row: OutboxRow, cat: DeliveryFailure) => {
    summary.failed++; bumpFailure(cat);
    await supabase.rpc('mark_telemetry_result', {
      p_id: row.id, p_lease_token: row.lease_token, p_status: 'failed', p_failure_category: cat,
    });
    const { data } = await supabase.from('telemetry_outbox').select('status').eq('id', row.id).maybeSingle();
    if ((data as { status?: string } | null)?.status === 'dead_letter') summary.dead_lettered++;
  };

  // 3/4. deliver + mark
  for (const row of rows) {
    const distinctId = await resolveDistinctId(supabase, row);
    if (!distinctId) { await markFailed(row, 'unknown'); continue; } // source gone / unattributable

    const payload = buildCapturePayload({ row, distinctId, projectKey, serverVerifiedSha });
    let status: number | null = null;
    try {
      const res = await deps.fetchImpl(`${posthogHost}/i/v0/e/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      status = res.status;
      // drain body so the connection is reusable; we never read/log its content.
      await res.text().catch(() => '');
    } catch { status = null; }

    if (status !== null && status >= 200 && status < 300) {
      const { data: ok } = await supabase.rpc('mark_telemetry_result', {
        p_id: row.id, p_lease_token: row.lease_token, p_status: 'sent', p_failure_category: null,
        p_server_verified_release_sha: serverVerifiedSha,
      });
      if (ok === true) summary.sent++; else await markFailed(row, 'unknown'); // lost the lease → retry later
    } else {
      await markFailed(row, classifyDeliveryFailure(status));
    }
  }

  // 5. sanitized Sentry alert (counts + categories only)
  if (sentryDsn && (summary.failed > 0 || summary.dead_lettered > 0)) {
    try {
      await deps.captureSentry(sentryDsn, {
        event_id: createSentryEventId(),
        timestamp: new Date().toISOString(),
        platform: 'javascript',
        level: summary.dead_lettered > 0 ? 'error' : 'warning',
        message: `telemetry-worker: ${summary.failed} failed, ${summary.dead_lettered} dead-lettered of ${summary.claimed} claimed`,
        environment: 'production',
        tags: { component: 'telemetry-worker', surface: 'edge' },
        extra: { ...summary }, // WorkerSummary is content-free (counts + category names only)
      });
    } catch { /* alerting must never fail the drain */ }
  }

  return json({ ok: true, ...summary }, 200);
}

if (import.meta.main) {
  serve((req) => handler(req));
}
