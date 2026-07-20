import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders } from '../_shared/cors.ts';
import { captureSentryEvent, createSentryEventId } from '../_shared/sentry.ts';

/**
 * Durable telemetry delivery worker (P0 incident foundation).
 *
 * Supabase is authoritative; this worker only DELIVERS already-persisted session/report events to
 * PostHog. It NEVER writes product data and NEVER rolls anything back. Each run:
 *   1. FAIL-CLOSED config validation — every required delivery + failure-alert secret must be present
 *      BEFORE any reconcile/claim (a missing server-verified SHA cannot silently produce sent rows).
 *   2. reconcile_telemetry_outbox(bounded rolling window) — repair recent gaps ONLY, never full history.
 *   3. claim_telemetry_batch() — lease a bounded batch (crash-safe: token + 5-min expiry).
 *   4. For each event: read the AUTHORITATIVE source row, build a STRICT server-side allowlisted
 *      payload (never transcript/title/description/audio/email/name), POST to PostHog /capture/ with
 *      $insert_id (PostHog dedupes) and the ORIGINAL timestamp.
 *   5. mark sent / failed(+category) / discard(source gone). Exhausted rows dead-letter.
 *   6. Sanitized Sentry alert on any failure/dead-letter/infra error (COUNTS + category names only —
 *      never a distinct_id, never content). Non-ok when dead-lettered or infra/RPC failure occurs.
 *
 * Content-free logs: distinct_id is resolved server-side at send time and NEVER logged.
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
  environment: string;
  backfilled: boolean;
};

export type DeliveryFailure = 'config_missing' | 'ingest_rejected' | 'transport_error' | 'unknown';

// Required configuration — the worker FAILS before reconcile/claim if any is absent.
export const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'POSTHOG_PROJECT_KEY',        // GitHub POSTHOG_PROJECT_API_KEY → here
  'POSTHOG_HOST',               // GitHub POSTHOG_INGEST_HOST → here
  'TELEMETRY_WORKER_RELEASE_SHA', // github.sha → here (server-verified SHA; sent rows must carry it)
  'SENTRY_DSN',                 // failure-alert route
] as const;

// ---- pure core (unit-tested) ----

export function classifyDeliveryFailure(status: number | null): DeliveryFailure {
  if (status === null) return 'transport_error';        // network / timeout / no response
  if (status === 429 || status >= 500) return 'transport_error';
  if (status >= 400) return 'ingest_rejected';
  return 'transport_error';
}

/** filler_words is a jsonb count-map (e.g. {"um":3,"uh":2}); the legacy event carried filler_count.
 * Recreate it authoritatively as the sum of the map's numeric values. */
export function sumFillerWords(fillerWords: unknown): number | null {
  if (!fillerWords || typeof fillerWords !== 'object') return null;
  let total = 0;
  for (const v of Object.values(fillerWords as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/** STRICT allowlist for session_saved, rebuilt from sessions columns. Recreatable authoritatively:
 * mode(engine), duration_seconds(duration), word_count(total_words), wpm, clarity_score, accuracy,
 * filler_count(derived). NOT recreatable server-side (client-only context, intentionally omitted):
 * is_new_streak_day, streak_count, session_coaching_*. */
export function buildSessionProps(src: Record<string, unknown>): Record<string, unknown> {
  return {
    mode: src.engine ?? null,
    duration_seconds: src.duration ?? null,
    word_count: src.total_words ?? null,
    wpm: src.wpm ?? null,
    clarity_score: src.clarity_score ?? null,
    accuracy: src.accuracy ?? null,
    filler_count: sumFillerWords(src.filler_words),
  };
}

/** STRICT allowlist for report_issue_submitted, rebuilt from user_issue_reports columns + a narrow set
 * of metadata keys. NEVER reads title/description/transcript_excerpt/page_url/userAgent/email.
 * NOT recreatable server-side: engine_variant (client breadcrumb only). */
export function buildReportProps(src: Record<string, unknown>): Record<string, unknown> {
  const md = (src.metadata && typeof src.metadata === 'object' ? src.metadata : {}) as Record<string, unknown>;
  return {
    issue_category: src.category ?? null,
    issue_severity: src.severity ?? null,
    session_id: src.session_id ?? null,
    route: typeof md.route === 'string' ? md.route : null,
    mode: typeof md.sttMode === 'string' ? md.sttMode : null,
  };
}

/** Build the PostHog /capture/ body. $insert_id dedupes; timestamp is the ORIGINAL event time; the
 * client SHA is labeled untrusted; server_verified_release_sha is the worker's own deploy SHA. */
export function buildCapturePayload(args: {
  row: OutboxRow;
  distinctId: string;
  productProps: Record<string, unknown>;
  projectKey: string;
  serverVerifiedSha: string;
}): Record<string, unknown> {
  const { row, distinctId, productProps, projectKey, serverVerifiedSha } = args;
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
      client_release_sha_untrusted: row.client_release_sha,
      server_verified_release_sha: serverVerifiedSha,
      backfilled: row.backfilled,
      outbox_attempt: row.attempt_count,
      ...productProps,
    },
  };
}

/** Stable, non-PII distinct id for a legitimate anonymous report (record_id is a random pseudonym). */
export function anonDistinctId(recordId: string): string {
  return `anon-report-${recordId}`;
}

/** Only HTTPS on an approved PostHog host is accepted for ingest — a misconfigured host must not
 * silently swallow events or exfiltrate to an arbitrary URL. */
export function isApprovedPosthogHost(host: string): boolean {
  try {
    const u = new URL(host);
    return u.protocol === 'https:' && /(^|\.)posthog\.com$/.test(u.hostname);
  } catch { return false; }
}

export type WorkerResult = 'success' | 'partial_retry' | 'hard_failure' | 'not_runnable';

export type WorkerSummary = {
  ok: boolean;
  result: WorkerResult;
  reconciled: number;
  reconcile_since: string;
  claimed: number;
  sent: number;
  failed: number;
  discarded: number;
  lease_lost: number;
  dead_lettered: number;
  infra_errors: number;
  time_budget_exhausted: boolean;
  failure_categories: Record<string, number>;
};

// ---- dependency-injected handler ----

export type WorkerDeps = {
  getEnv: (k: string) => string | undefined;
  createSupabase: (url: string, key: string) => SupabaseClient;
  fetchImpl: typeof fetch;
  captureSentry: typeof captureSentryEvent;
  now: () => number;
};

const defaultDeps: WorkerDeps = {
  getEnv: (k) => Deno.env.get(k),
  createSupabase: (url, key) => createClient(url, key, { auth: { persistSession: false } }),
  fetchImpl: fetch,
  captureSentry: captureSentryEvent,
  now: () => Date.now(),
};

const SOURCE_TABLE: Record<OutboxRow['event_type'], string> = {
  session_saved: 'sessions',
  report_issue_submitted: 'user_issue_reports',
};
const SOURCE_COLUMNS: Record<OutboxRow['event_type'], string> = {
  session_saved: 'user_id, engine, duration, total_words, wpm, clarity_score, accuracy, filler_words',
  report_issue_submitted: 'user_id, category, severity, session_id, metadata',
};

export async function handler(req: Request, deps: WorkerDeps = defaultDeps): Promise<Response> {
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;
  const headers = corsHeaders(req);
  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const configuredSecret = deps.getEnv('TELEMETRY_WORKER_SECRET');
  const providedSecret = req.headers.get('x-telemetry-worker-secret');
  if (!configuredSecret || providedSecret !== configuredSecret) return json({ error: 'not_found' }, 404);

  // (1) FAIL-CLOSED config validation — before any reconcile/claim. not_runnable, never green.
  const missing = REQUIRED_ENV.filter((k) => !deps.getEnv(k));
  if (missing.length > 0) return json({ ok: false, result: 'not_runnable', error: 'config_missing', missing }, 503);

  const supabaseUrl = deps.getEnv('SUPABASE_URL')!;
  const serviceKey = deps.getEnv('SUPABASE_SERVICE_ROLE_KEY')!;
  const projectKey = deps.getEnv('POSTHOG_PROJECT_KEY')!;
  const ingestHost = deps.getEnv('POSTHOG_HOST')!.replace(/\/$/, '');
  const serverVerifiedSha = deps.getEnv('TELEMETRY_WORKER_RELEASE_SHA')!;
  const sentryDsn = deps.getEnv('SENTRY_DSN')!;

  // POSTHOG_HOST must be HTTPS on an approved PostHog host.
  if (!isApprovedPosthogHost(ingestHost)) return json({ ok: false, result: 'not_runnable', error: 'config_invalid_posthog_host' }, 503);

  // PROOF-ONLY mode: an explicit synthetic record is delivered WITHOUT reconciliation or batch
  // draining. It bypasses the enable gate (that is its purpose) but can only ever touch one specified
  // automated_test row — see claim_telemetry_proof_row. Requires an event type + record id.
  const proofRecord = req.headers.get('x-telemetry-proof-record');
  const proofEvent = req.headers.get('x-telemetry-proof-event');
  const proofMode = proofRecord !== null;

  // (1b) OVERLAP-SAFE gate: NORMAL draining is disabled unless explicitly enabled at cutover. This
  // prevents accidental draining of real records while client emitters are still authoritative. Proof
  // mode is exempt (it targets one synthetic automated_test row only).
  if (!proofMode && deps.getEnv('TELEMETRY_WORKER_ENABLED') !== 'true') return json({ ok: false, result: 'not_runnable', error: 'worker_disabled' }, 200);

  const windowSec = Math.max(60, Number(deps.getEnv('TELEMETRY_RECONCILE_WINDOW_SECONDS') ?? '3600') || 3600);
  const eventTimeoutMs = Math.max(1000, Number(deps.getEnv('TELEMETRY_EVENT_TIMEOUT_MS') ?? '10000') || 10000);
  const deadlineMs = Math.max(5000, Number(deps.getEnv('TELEMETRY_WORKER_DEADLINE_MS') ?? '90000') || 90000);
  const concurrency = Math.max(1, Math.min(Number(deps.getEnv('TELEMETRY_WORKER_CONCURRENCY') ?? '5') || 5, 16));
  // Worst-case must fit the shared deadline: ceil(batch/concurrency)*eventTimeout ≤ deadline. Default
  // batch is derived from the deadline so 50×10s>90s can never happen; an explicit override is clamped.
  const maxBatchForDeadline = Math.max(1, Math.floor(deadlineMs / eventTimeoutMs) * concurrency);
  const requestedBatch = Math.max(1, Math.min(Number(deps.getEnv('TELEMETRY_WORKER_BATCH') ?? '25') || 25, 200));
  const batchSize = Math.min(requestedBatch, maxBatchForDeadline);

  const supabase = deps.createSupabase(supabaseUrl, serviceKey);
  const start = deps.now();
  const reconcileSince = new Date(start - windowSec * 1000).toISOString();

  const summary: WorkerSummary = {
    ok: true, result: 'success', reconciled: 0, reconcile_since: reconcileSince, claimed: 0, sent: 0, failed: 0,
    discarded: 0, lease_lost: 0, dead_lettered: 0, infra_errors: 0, time_budget_exhausted: false,
    failure_categories: {},
  };
  const bump = (cat: DeliveryFailure) => { summary.failure_categories[cat] = (summary.failure_categories[cat] ?? 0) + 1; };

  const sentryAlert = async (level: 'error' | 'warning', message: string) => {
    try {
      await deps.captureSentry(sentryDsn, {
        event_id: createSentryEventId(), timestamp: new Date().toISOString(), platform: 'javascript',
        level, message, environment: 'production',
        tags: { component: 'telemetry-worker', surface: 'edge' },
        extra: { ...summary }, // WorkerSummary is content-free (counts + category names only)
      });
    } catch { /* alerting must never fail the drain */ }
  };

  // mark helpers — every RPC error/false is accounted for; NO recursive re-mark on a lost lease.
  const markSent = async (row: OutboxRow) => {
    const { data, error } = await supabase.rpc('mark_telemetry_result', {
      p_id: row.id, p_lease_token: row.lease_token, p_status: 'sent', p_failure_category: null,
      p_server_verified_release_sha: serverVerifiedSha,
    });
    if (error) { summary.infra_errors++; return; }
    if (data === true) summary.sent++; else summary.lease_lost++; // lease lost → left sending, reclaimed later
  };
  const markFailed = async (row: OutboxRow, cat: DeliveryFailure) => {
    const { data, error } = await supabase.rpc('mark_telemetry_result', {
      p_id: row.id, p_lease_token: row.lease_token, p_status: 'failed', p_failure_category: cat,
    });
    if (error) { summary.infra_errors++; return; }
    if (data !== true) { summary.lease_lost++; return; }
    summary.failed++; bump(cat);
    const { data: statusRow, error: readErr } = await supabase.from('telemetry_outbox').select('status').eq('id', row.id).maybeSingle();
    if (readErr) { summary.infra_errors++; return; }
    if ((statusRow as { status?: string } | null)?.status === 'dead_letter') summary.dead_lettered++;
  };
  const discard = async (row: OutboxRow) => {
    const { data, error } = await supabase.rpc('discard_telemetry_event', { p_id: row.id, p_lease_token: row.lease_token });
    if (error) { summary.infra_errors++; return; }
    if (data === true) summary.discarded++; else summary.lease_lost++;
  };

  // (4/5) deliver + mark, one row at a time, under BOUNDED CONCURRENCY. Worst-case wall-clock is
  // ceil(batch/concurrency)*eventTimeout, kept ≤ deadline by the batch clamp above.
  const processRow = async (row: OutboxRow) => {
    const { data: src, error: srcErr } = await supabase
      .from(SOURCE_TABLE[row.event_type]).select(SOURCE_COLUMNS[row.event_type]).eq('id', row.record_id).maybeSingle();
    if (srcErr) { summary.infra_errors++; return; } // transient DB error → leave leased, retry later
    if (!src) { await discard(row); return; }        // source gone (deleted account/session) → tombstone

    const source = src as unknown as Record<string, unknown>;
    const distinctId = row.event_type === 'session_saved'
      ? (source.user_id as string | null)               // sessions.user_id is NOT NULL when the row exists
      : ((source.user_id as string | null) ?? anonDistinctId(row.record_id)); // legitimate anonymous report
    if (!distinctId) { await discard(row); return; }  // defensive: no attributable identity

    const productProps = row.event_type === 'session_saved' ? buildSessionProps(source) : buildReportProps(source);
    const payload = buildCapturePayload({ row, distinctId, productProps, projectKey, serverVerifiedSha });

    let status: number | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), eventTimeoutMs);
    try {
      const res = await deps.fetchImpl(`${ingestHost}/capture/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
      });
      status = res.status;
      await res.text().catch(() => ''); // drain; never read/log content
    } catch { status = null; } finally { clearTimeout(timer); }

    if (status !== null && status >= 200 && status < 300) await markSent(row);
    else await markFailed(row, classifyDeliveryFailure(status));
  };

  // ---- PROOF-ONLY branch: claim exactly the one specified automated_test row; NO reconcile, NO batch.
  if (proofMode) {
    if (proofEvent !== 'session_saved' && proofEvent !== 'report_issue_submitted') {
      return json({ ok: false, result: 'not_runnable', error: 'proof_event_invalid' }, 400);
    }
    const { data: proofRows, error: proofErr } = await supabase.rpc('claim_telemetry_proof_row', {
      p_record_id: proofRecord, p_event_type: proofEvent, p_worker: 'edge-telemetry-worker-proof',
    });
    if (proofErr) { summary.infra_errors++; return json({ ...summary, ok: false, result: 'hard_failure', error: 'proof_claim_failed' }, 500); }
    const claimed = (proofRows ?? []) as OutboxRow[];
    // Refuses a non-automated_test / non-existent / already-delivered row (the RPC returns nothing).
    if (claimed.length === 0) return json({ ...summary, ok: false, result: 'not_runnable', error: 'no_claimable_automated_test_row' }, 200);
    summary.claimed = claimed.length;
    await processRow(claimed[0]);
    const hard = summary.infra_errors > 0 || summary.dead_lettered > 0 || summary.lease_lost > 0;
    summary.ok = !hard;
    summary.result = hard ? 'hard_failure' : (summary.failed > 0 ? 'partial_retry' : 'success');
    return json({ ...summary, proof_mode: true }, 200);
  }

  // (2) reconcile a BOUNDED rolling window (never full history).
  const { data: reconciledData, error: reconcileErr } = await supabase.rpc('reconcile_telemetry_outbox', { p_since: reconcileSince });
  if (reconcileErr) { summary.ok = false; summary.result = 'hard_failure'; summary.infra_errors++; await sentryAlert('error', 'telemetry-worker: reconcile failed'); return json({ ...summary, error: 'reconcile_failed' }, 500); }
  summary.reconciled = Number(reconciledData ?? 0);

  // (3) claim a bounded batch.
  const { data: rowsData, error: claimErr } = await supabase.rpc('claim_telemetry_batch', { p_limit: batchSize, p_worker: 'edge-telemetry-worker' });
  if (claimErr) { summary.ok = false; summary.result = 'hard_failure'; summary.infra_errors++; await sentryAlert('error', 'telemetry-worker: claim failed'); return json({ ...summary, error: 'claim_failed' }, 500); }
  const rows = (rowsData ?? []) as OutboxRow[];
  summary.claimed = rows.length;

  let next = 0;
  const runLane = async () => {
    for (;;) {
      if (deps.now() - start > deadlineMs) { summary.time_budget_exhausted = true; return; } // rest stay leased → reclaimed next run
      const i = next++;
      if (i >= rows.length) return;
      await processRow(rows[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, rows.length)) }, () => runLane()));

  // (6) result semantics. GREEN only when none of the hard conditions occurred; retryable delivery
  // failures alone are 'partial_retry' (self-heals on the next run).
  const hardFailure = summary.infra_errors > 0 || summary.dead_lettered > 0 || summary.lease_lost > 0 || summary.time_budget_exhausted;
  summary.ok = !hardFailure;
  summary.result = hardFailure ? 'hard_failure' : (summary.failed > 0 ? 'partial_retry' : 'success');
  if (summary.failed > 0 || hardFailure) {
    await sentryAlert(hardFailure ? 'error' : 'warning',
      `telemetry-worker[${summary.result}]: ${summary.failed} failed, ${summary.dead_lettered} dead-lettered, ${summary.lease_lost} lease-lost, ${summary.infra_errors} infra of ${summary.claimed} claimed`);
  }

  return json({ ...summary }, 200);
}

if (import.meta.main) {
  serve((req) => handler(req));
}
