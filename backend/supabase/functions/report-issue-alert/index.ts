// P0.4 — trusted-backend owner alert for a submitted issue report.
//
// The full report is persisted by the browser directly into public.user_issue_reports (RLS). AFTER
// that write succeeds, the browser calls this function with ONLY the durable report id. This
// function (the trusted backend) then:
//   1. authenticates the caller and scopes the report to them (or an anonymous report),
//   2. atomically claims the alert (durable dedupe by report_id — exactly one alert per report),
//   3. builds the alert payload from an EXPLICIT ALLOWLIST read off the stored row (never from the
//      request body, never by copy-and-delete),
//   4. emits a sanitized Sentry alert (manual envelope — no SDK, so no user/request/cookie/PII
//      context is ever attached), and
//   5. records a sanitized delivery state (pending/sent/failed + fixed failure category).
//
// It NEVER reads or forwards report prose, transcript, audio, email, name, tokens, cookies, or
// headers. Alert failure is recorded and returned as a non-fatal result — the report is already
// safely stored, so submission success is independent of alert delivery.

import { corsGuard, corsHeaders } from "../_shared/cors.ts";
import { captureSentryEvent } from "../_shared/sentry.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** DETERMINISTIC Sentry event_id derived from the report id (a uuid → its 32 hex chars). Because it is
 * stable per report, a retry after "Sentry accepted but the DB mark failed" reuses the SAME event_id,
 * so Sentry dedupes and the owner never receives a duplicate alert for one report. */
export function deterministicEventId(reportId: string): string {
  return reportId.replaceAll("-", "").toLowerCase();
}

// ---- The ONLY fields allowed to leave the trusted boundary in an alert. ----
export interface AlertPayload {
  report_id: string;
  severity: "critical" | "high" | "normal";
  release_sha: string | null;
  route: string | null;
  stt_mode: string | null;
  session_id: string | null;
  timestamp: string;
}

export const ALERT_PAYLOAD_KEYS: ReadonlyArray<keyof AlertPayload> = [
  "report_id",
  "severity",
  "release_sha",
  "route",
  "stt_mode",
  "session_id",
  "timestamp",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
const RECOGNIZED_STT_MODES = new Set([
  "Private",
  "Native",
  "Cloud",
  "native",
  "cloud",
  "private",
]);

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Deterministic severity mapping from the STORED classification (never AI/prose inference).
// critical → highest (P0), high → elevated/actionable (P1), everything else → normal review.
export function normalizeSeverity(stored: unknown): AlertPayload["severity"] {
  if (stored === "critical") return "critical";
  if (stored === "high") return "high";
  return "normal";
}

function sentryLevel(sev: AlertPayload["severity"]): string {
  return sev === "critical" ? "fatal" : sev === "high" ? "error" : "warning";
}

function validReleaseSha(v: unknown): string | null {
  return typeof v === "string" && SHA_RE.test(v) ? v : null;
}

// Bounded route: path only (no query/fragment), capped length. Never a full URL with PII params.
function boundedRoute(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  let path = v;
  try {
    // If it's an absolute URL, keep only the pathname; otherwise strip any ?/# ourselves.
    path = v.startsWith("http") ? new URL(v).pathname : v.split(/[?#]/)[0];
  } catch {
    path = v.split(/[?#]/)[0];
  }
  return path.slice(0, 120) || null;
}

function recognizedSttMode(v: unknown): string | null {
  return typeof v === "string" && RECOGNIZED_STT_MODES.has(v) ? v : null;
}

// ---- Server-assigned provenance (NEVER from the browser). Resolved from the trusted registry and
// carried into Sentry tags so internal/automated testing is distinguishable from real user data. ----
const DATA_ORIGINS = new Set([
  "automated_test", "seed_fixture", "owner_manual_test", "beta_tester",
  "production_user", "synthetic_monitor", "legacy_unclassified",
]);
const MARKER_RE = /^[A-Za-z0-9._:-]{1,64}$/; // bounded, safe-charset marker values

export interface Provenance {
  data_origin: string;
  cohort_id: string | null;
  test_run_id: string | null;
  test_suite: string | null;
  environment: string;
  server_verified_release_sha: string | null;
}

function safeMarker(v: unknown): string | null {
  return typeof v === "string" && MARKER_RE.test(v) ? v : null;
}

/** Validate a raw resolver row into a strict, bounded Provenance. Unknown/invalid origin →
 * legacy_unclassified (never trusted-up). */
export function normalizeProvenance(raw: Record<string, unknown> | null, serverSha: string | null): Provenance {
  const origin = typeof raw?.data_origin === "string" && DATA_ORIGINS.has(raw.data_origin) ? raw.data_origin : "legacy_unclassified";
  return {
    data_origin: origin,
    cohort_id: safeMarker(raw?.cohort_id),
    test_run_id: safeMarker(raw?.test_run_id),
    test_suite: safeMarker(raw?.test_suite),
    environment: typeof raw?.environment === "string" && raw.environment ? raw.environment : "production",
    server_verified_release_sha: validReleaseSha(serverSha),
  };
}

// Row shape we read (a deliberately narrow SELECT — no title/description/transcript/audio columns).
export interface StoredReportRow {
  id: string;
  severity: string | null;
  session_id: string | null;
  page_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_id: string | null;
}

/** Build the alert payload from a NEW object using the explicit allowlist (no copy-and-delete). */
export function buildAlertPayload(row: StoredReportRow): AlertPayload {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const runtime = (meta.appRuntimeConfig ?? {}) as Record<string, unknown>;
  return {
    report_id: row.id,
    severity: normalizeSeverity(row.severity),
    release_sha: validReleaseSha(runtime.release),
    route: boundedRoute(meta.route ?? row.page_url),
    stt_mode: recognizedSttMode(meta.sttMode),
    session_id: isUuid(row.session_id) ? row.session_id : null,
    timestamp: row.created_at, // server-generated DB default
  };
}

/** Build the Sentry event. Contains ONLY allowlisted fields + validated server-assigned provenance
 * tags (so internal/automated testing is distinguishable). No user/request/breadcrumb context, no
 * prose/email/name/user_id/token/headers/arbitrary metadata. */
export function buildSentryEvent(payload: AlertPayload, eventId: string, prov: Provenance) {
  const tags: Record<string, string> = {
    surface: "report-issue",
    report_id: payload.report_id,
    severity: payload.severity,
    // server-assigned provenance markers (validated + bounded).
    data_origin: prov.data_origin,
    environment: prov.environment,
  };
  if (payload.release_sha) tags.release_sha = payload.release_sha;
  if (payload.route) tags.route = payload.route;
  if (payload.stt_mode) tags.stt_mode = payload.stt_mode;
  if (payload.session_id) tags.session_id = payload.session_id;
  if (prov.cohort_id) tags.cohort_id = prov.cohort_id;
  if (prov.test_run_id) tags.test_run_id = prov.test_run_id;
  if (prov.test_suite) tags.test_suite = prov.test_suite;
  if (prov.server_verified_release_sha) tags.server_verified_release_sha = prov.server_verified_release_sha;
  return {
    event_id: eventId,
    timestamp: payload.timestamp,
    platform: "other",
    level: sentryLevel(payload.severity),
    // report_id is a UUID — no prose. NO extra{} with report content, NO user{}, NO request{}.
    message:
      `SpeakSharp issue report ${payload.report_id} (${payload.severity}) [${prov.data_origin}]`,
    environment: prov.environment,
    tags,
  };
}

type FailureCategory =
  | "sentry_config_missing"
  | "sentry_ingest_rejected"
  | "transport_error"
  | "unknown";

export function classifyFailure(err: unknown): FailureCategory {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Sentry ingest rejected/i.test(msg)) return "sentry_ingest_rejected";
  if (/fetch|network|ENOTFOUND|ECONNRESET|timeout/i.test(msg)) {
    return "transport_error";
  }
  return "unknown";
}

export interface HandlerDeps {
  getEnv?: (key: string) => string | undefined;
  createUserClient?: (authHeader: string) => SupabaseClient;
  createAdminClient?: () => SupabaseClient;
  sendSentry?: (
    dsn: string,
    event: ReturnType<typeof buildSentryEvent>,
    opts?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  // Sanitized operational logger (report_id + category + timestamp + release_sha only).
  logOps?: (evidence: Record<string, string | null>) => void;
  now?: () => number;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// The NARROW report SELECT (no prose/transcript/audio columns).
const REPORT_SELECT = "id, severity, session_id, page_url, metadata, created_at, user_id";

type SendSentry = (dsn: string, event: ReturnType<typeof buildSentryEvent>, opts?: { signal?: AbortSignal }) => Promise<unknown>;
type LogOps = (evidence: Record<string, string | null>) => void;

// Fully-accounted per-row outcome. Exactly one of these is returned for every claimed row.
export type Disposition = "sent" | "mark_deferred" | "failed" | "lease_lost" | "infra_error" | "time_budget";

// Provenance is read from the SNAPSHOT stored on the delivery row at report creation — never
// re-resolved at delivery. A read FAILURE is an infra_error (retry), never a silent legacy downgrade.
async function readSnapshotProvenance(admin: SupabaseClient, reportId: string, serverSha: string | null): Promise<Provenance | null> {
  const { data, error } = await admin.from("report_alert_deliveries")
    .select("data_origin, cohort_id, test_run_id, test_suite, environment").eq("report_id", reportId).maybeSingle();
  if (error) return null; // signal infra_error to the caller
  return normalizeProvenance(data as Record<string, unknown> | null, serverSha);
}

/** Deliver ONE already-claimed alert under its lease, fully accounted. Provenance is the AT-INSERT
 * snapshot (resolved by the caller). Deterministic event_id makes a re-send after a lost mark dedupe.
 * The Sentry send is bounded to `sentryTimeoutMs` (a nonpositive budget means DON'T start — never a
 * fresh 1000ms request). `remainingFn` is checked before the mark so the mark always has reserved time. */
async function deliverClaimed(
  admin: SupabaseClient, report: StoredReportRow, leaseToken: string,
  dsn: string | undefined, sendSentry: SendSentry, logOps: LogOps,
  opts: { provenance: Provenance; sentryTimeoutMs: number; remainingFn: () => number },
): Promise<{ disposition: Disposition; failure_category: string | null }> {
  const payload = buildAlertPayload(report);
  // mark → { ok: DB confirmed under our lease, errored: RPC error (infra) }.
  const mark = async (status: "sent" | "failed", cat: string | null) => {
    const { data, error } = await admin.rpc("mark_report_alert", {
      p_report_id: payload.report_id, p_lease_token: leaseToken, p_status: status, p_failure_category: cat,
    });
    return { ok: !error && data === true, errored: !!error };
  };

  if (!dsn) {
    const m = await mark("failed", "sentry_config_missing");
    logOps({ report_id: payload.report_id, failure_category: "sentry_config_missing", timestamp: payload.timestamp, release_sha: payload.release_sha });
    if (m.errored) return { disposition: "infra_error", failure_category: "sentry_config_missing" };
    return { disposition: m.ok ? "failed" : "lease_lost", failure_category: "sentry_config_missing" };
  }

  // A nonpositive Sentry budget means there is not enough time — do NOT start (never a fresh 1000ms).
  if (opts.sentryTimeoutMs <= 0) return { disposition: "time_budget", failure_category: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.sentryTimeoutMs);
  try {
    await sendSentry(dsn, buildSentryEvent(payload, deterministicEventId(payload.report_id), opts.provenance), { signal: controller.signal });
    // Before the MARK: if the send consumed the reserved budget, don't mark (reclaimed; deterministic id dedupes).
    if (opts.remainingFn() <= 0) return { disposition: "time_budget", failure_category: null };
    const m = await mark("sent", null);
    if (m.errored) return { disposition: "infra_error", failure_category: null };
    // Sent OK; mark false = lost lease → deterministic id makes the reclaim's re-send dedupe.
    return { disposition: m.ok ? "sent" : "mark_deferred", failure_category: null };
  } catch (err) {
    const failure_category = classifyFailure(err);
    const m = await mark("failed", failure_category);
    logOps({ report_id: payload.report_id, failure_category, timestamp: payload.timestamp, release_sha: payload.release_sha });
    if (m.errored) return { disposition: "infra_error", failure_category };
    return { disposition: m.ok ? "failed" : "lease_lost", failure_category };
  } finally { clearTimeout(timer); }
}

export async function handler(
  req: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  // Exact-origin CORS guard first (hostile origin → 403 before any auth/DB/provider work).
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

  const headers = corsHeaders(req);
  const getEnv = deps.getEnv ?? ((k: string) => Deno.env.get(k) ?? undefined);
  const logOps = deps.logOps ??
    ((e) => console.warn(`[report-issue-alert] ${JSON.stringify(e)}`));

  const createUserClient = deps.createUserClient ??
    ((authHeader: string) =>
      createClient(getEnv("SUPABASE_URL")!, getEnv("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      }));
  const createAdminClient = deps.createAdminClient ??
    (() =>
      createClient(
        getEnv("SUPABASE_URL")!,
        getEnv("SUPABASE_SERVICE_ROLE_KEY")!,
        {
          auth: { autoRefreshToken: false, persistSession: false },
        },
      ));
  const sendSentry = deps.sendSentry ??
    ((dsn, event, opts) => captureSentryEvent(dsn, event, opts));

  // ---- SECRET-GATED BATCH DRAIN (the periodic drainer; the browser wake-hint is only best-effort).
  // reconcile → claim a batch → deliver each under its lease. This is what guarantees a crashed or
  // never-fired wake-hint cannot strand a report: the cron drains due/expired-lease alert rows. ----
  const providedDrainSecret = req.headers.get("x-alert-worker-secret");
  if (providedDrainSecret !== null) {
    const drainSecret = getEnv("ALERT_WORKER_SECRET") ?? getEnv("TELEMETRY_WORKER_SECRET");
    if (!drainSecret || providedDrainSecret !== drainSecret) return json(404, { error: { code: "not_found" } }, headers);
    const admin = createAdminClient();
    const dsn = getEnv("SENTRY_DSN");
    const serverSha = getEnv("TELEMETRY_WORKER_RELEASE_SHA") ?? null;
    const num = (k: string, d: number) => Math.max(1, Number(getEnv(k) ?? String(d)) || d);
    // Bounded: one shared absolute deadline; batch clamped so ceil(batch/concurrency)*eventTimeout ≤ deadline.
    const deadlineMs = Math.max(5000, num("ALERT_WORKER_DEADLINE_MS", 90000));
    const eventTimeoutMs = Math.max(1000, num("ALERT_EVENT_TIMEOUT_MS", 10000));
    const markReserveMs = Math.max(500, Math.min(num("ALERT_MARK_RESERVE_MS", 3000), Math.floor(deadlineMs / 3)));
    const concurrency = Math.min(num("ALERT_WORKER_CONCURRENCY", 5), 16);
    const maxBatch = Math.max(1, Math.floor(deadlineMs / eventTimeoutMs) * concurrency);
    const batchSize = Math.min(num("ALERT_WORKER_BATCH", 25), 200, maxBatch);
    const windowSec = num("ALERT_RECONCILE_WINDOW_SECONDS", 86400);
    const nowFn = deps.now ?? (() => Date.now());
    const since = new Date(nowFn() - windowSec * 1000).toISOString();
    const start = nowFn();

    const { error: recErr } = await admin.rpc("reconcile_report_alerts", { p_since: since });
    if (recErr) return json(500, { ok: false, result: "hard_failure", error: "reconcile_failed" }, headers);
    const { data: rows, error: claimErr } = await admin.rpc("claim_report_alert_batch", { p_limit: batchSize, p_worker: "report-alert-drain" });
    if (claimErr) return json(500, { ok: false, result: "hard_failure", error: "claim_failed" }, headers);
    // Claimed rows include the AT-INSERT provenance SNAPSHOT (claim returns report_alert_deliveries.*).
    const claimed = (rows ?? []) as Array<Record<string, unknown> & { report_id: string; lease_token: string }>;

    const s = { claimed: claimed.length, sent: 0, failed: 0, mark_deferred: 0, source_gone: 0, lease_lost: 0, infra_errors: 0, time_budget_exhausted: false };
    const remaining = () => deadlineMs - (nowFn() - start);
    const opBudget = () => Math.min(eventTimeoutMs, remaining() - markReserveMs); // reserve mark time

    const processOne = async (d: Record<string, unknown> & { report_id: string; lease_token: string }) => {
      // Before the SOURCE READ: reserve time for read + provider + mark.
      let budget = opBudget();
      if (budget <= 0) { s.time_budget_exhausted = true; return; } // don't start; stays leased
      const srcCtl = new AbortController();
      const srcTimer = setTimeout(() => srcCtl.abort(), budget);
      let report: unknown, srcErr: unknown;
      try {
        const r = await admin.from("user_issue_reports").select(REPORT_SELECT).eq("id", d.report_id).abortSignal(srcCtl.signal).maybeSingle();
        report = r.data; srcErr = r.error;
      } catch (e) { srcErr = e; } finally { clearTimeout(srcTimer); }
      if (srcErr) { s.infra_errors++; return; } // source-read failure/abort → hard; leave leased, retry later
      if (!report) {
        // Missing source (should be prevented by FK cascade). Explicit safe disposition: bounded mark.
        const { data, error } = await admin.rpc("mark_report_alert", { p_report_id: d.report_id, p_lease_token: d.lease_token, p_status: "failed", p_failure_category: "unknown" });
        if (error) s.infra_errors++; else if (data === true) s.source_gone++; else s.lease_lost++;
        return;
      }
      // Before delivery: recompute the budget (reserving mark time). Provenance = the claimed row's snapshot.
      budget = opBudget();
      if (budget <= 0) { s.time_budget_exhausted = true; return; }
      const prov = normalizeProvenance(d, serverSha);
      const r = await deliverClaimed(admin, report as StoredReportRow, d.lease_token, dsn, sendSentry, logOps,
        { provenance: prov, sentryTimeoutMs: budget, remainingFn: remaining });
      if (r.disposition === "sent") s.sent++;
      else if (r.disposition === "mark_deferred") s.mark_deferred++;
      else if (r.disposition === "failed") s.failed++;
      else if (r.disposition === "lease_lost") s.lease_lost++;
      else if (r.disposition === "time_budget") s.time_budget_exhausted = true;
      else s.infra_errors++;
    };
    // Bounded concurrency + shared deadline; unprocessed rows stay leased → reclaimed next drain.
    let next = 0;
    const lane = async () => {
      for (;;) {
        if (remaining() <= 0) { s.time_budget_exhausted = true; return; }
        const i = next++;
        if (i >= claimed.length) return;
        await processOne(claimed[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, claimed.length)) }, () => lane()));

    const accounted = s.sent + s.failed + s.mark_deferred + s.source_gone + s.lease_lost + s.infra_errors;
    const unaccounted = s.claimed - accounted; // rows dropped by deadline exhaustion
    // GREEN only when nothing hard occurred and every claimed row is accounted.
    const hard = s.infra_errors > 0 || s.lease_lost > 0 || s.time_budget_exhausted || unaccounted !== 0;
    const result = hard ? "hard_failure" : ((s.failed > 0 || s.source_gone > 0) ? "partial_retry" : "success");
    return json(200, { ok: !hard, result, unaccounted, ...s }, headers);
  }

  // Authenticate the caller (cryptographically, via getUser). CORS is not auth.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(401, { error: { code: "auth_required" } }, headers);
  }
  const { data: { user }, error: authError } = await createUserClient(
    authHeader,
  ).auth.getUser();
  if (authError || !user) {
    return json(401, { error: { code: "auth_invalid" } }, headers);
  }

  // Parse ONLY the report id from the body — never any content.
  let reportId: unknown;
  try {
    reportId = (await req.json())?.reportId;
  } catch {
    return json(400, { error: { code: "invalid_body" } }, headers);
  }
  if (!isUuid(reportId)) {
    return json(400, { error: { code: "invalid_report_id" } }, headers);
  }

  const admin = createAdminClient();

  // Narrow SELECT — no prose/transcript/audio columns are ever read.
  const { data: report, error: readError } = await admin
    .from("user_issue_reports")
    .select("id, severity, session_id, page_url, metadata, created_at, user_id")
    .eq("id", reportId)
    .maybeSingle();
  if (readError) return json(500, { error: { code: "read_failed" } }, headers);
  if (!report) return json(404, { error: { code: "not_found" } }, headers);

  // FAIL-CLOSED exact ownership: the authenticated wake-hint may trigger ONLY the caller's own
  // non-null-user report. A NULL-user (anonymous) report is NEVER triggerable by an arbitrary
  // authenticated caller who knows a report UUID — anonymous alerts are delivered exclusively by the
  // server-authoritative outbox trigger + reconciler + drain.
  if (!report.user_id || report.user_id !== user.id) {
    return json(403, { error: { code: "forbidden" } }, headers);
  }

  // Lease-based claim. NULL = already sent / in-flight (unexpired lease) / dead-letter → no second
  // alert. The row was enqueued authoritatively by the DB trigger; this call is only a wake hint.
  const { data: leaseToken, error: claimError } = await admin.rpc(
    "claim_report_alert",
    { p_report_id: reportId, p_worker: "report-issue-alert-wake-hint" },
  );
  if (claimError) {
    return json(500, { error: { code: "claim_failed" } }, headers);
  }
  if (!leaseToken) {
    return json(200, { report_id: reportId, deduped: true }, headers);
  }

  // Deliver under our lease via the shared helper. Provenance = the AT-INSERT snapshot (a read failure
  // is infra, never a silent legacy downgrade). The single wake-hint has no drain deadline.
  const eventTimeoutMs = Math.max(1000, Number(getEnv("ALERT_EVENT_TIMEOUT_MS") ?? "10000") || 10000);
  const serverSha = getEnv("TELEMETRY_WORKER_RELEASE_SHA") ?? null;
  const prov = await readSnapshotProvenance(admin, reportId, serverSha);
  if (prov === null) return json(200, { report_id: reportId, alerted: false, infra_error: true }, headers);
  const r = await deliverClaimed(admin, report as StoredReportRow, leaseToken as string, getEnv("SENTRY_DSN"), sendSentry, logOps,
    { provenance: prov, sentryTimeoutMs: eventTimeoutMs, remainingFn: () => 1 });
  return json(200, {
    report_id: reportId,
    alerted: r.disposition === "sent",
    ...(r.disposition === "mark_deferred" ? { mark_deferred: true } : {}),
    ...(r.disposition === "infra_error" ? { infra_error: true } : {}),
    ...(r.failure_category ? { failure_category: r.failure_category } : {}),
  }, headers);
}

if (import.meta.main) {
  Deno.serve((req: Request) => handler(req));
}
