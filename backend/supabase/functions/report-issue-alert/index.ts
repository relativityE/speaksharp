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

/** Build the Sentry event. Contains ONLY allowlisted fields; no user/request/breadcrumb context. */
export function buildSentryEvent(payload: AlertPayload, eventId: string) {
  const tags: Record<string, string> = {
    surface: "report-issue",
    report_id: payload.report_id,
    severity: payload.severity,
  };
  if (payload.release_sha) tags.release_sha = payload.release_sha;
  if (payload.route) tags.route = payload.route;
  if (payload.stt_mode) tags.stt_mode = payload.stt_mode;
  if (payload.session_id) tags.session_id = payload.session_id;
  return {
    event_id: eventId,
    timestamp: payload.timestamp,
    platform: "other",
    level: sentryLevel(payload.severity),
    // report_id is a UUID — no prose. NO extra{} with report content, NO user{}, NO request{}.
    message:
      `SpeakSharp issue report ${payload.report_id} (${payload.severity})`,
    environment: "production",
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
  ) => Promise<unknown>;
  // Sanitized operational logger (report_id + category + timestamp + release_sha only).
  logOps?: (evidence: Record<string, string | null>) => void;
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

type SendSentry = (dsn: string, event: ReturnType<typeof buildSentryEvent>) => Promise<unknown>;
type LogOps = (evidence: Record<string, string | null>) => void;

/** Deliver ONE already-claimed alert under its lease. Deterministic event_id makes a re-send after a
 * lost mark dedupe. Returns whether the DB mark actually succeeded. */
async function deliverClaimed(
  admin: SupabaseClient, report: StoredReportRow, leaseToken: string,
  dsn: string | undefined, sendSentry: SendSentry, logOps: LogOps,
): Promise<{ alerted: boolean; mark_deferred: boolean; failure_category: string | null }> {
  const payload = buildAlertPayload(report);
  const mark = async (status: "sent" | "failed", cat: string | null) => {
    const { data, error } = await admin.rpc("mark_report_alert", {
      p_report_id: payload.report_id, p_lease_token: leaseToken, p_status: status, p_failure_category: cat,
    });
    return !error && data === true;
  };
  if (!dsn) {
    await mark("failed", "sentry_config_missing");
    logOps({ report_id: payload.report_id, failure_category: "sentry_config_missing", timestamp: payload.timestamp, release_sha: payload.release_sha });
    return { alerted: false, mark_deferred: false, failure_category: "sentry_config_missing" };
  }
  try {
    await sendSentry(dsn, buildSentryEvent(payload, deterministicEventId(payload.report_id)));
    const marked = await mark("sent", null);
    return { alerted: marked, mark_deferred: !marked, failure_category: null };
  } catch (err) {
    const failure_category = classifyFailure(err);
    await mark("failed", failure_category);
    logOps({ report_id: payload.report_id, failure_category, timestamp: payload.timestamp, release_sha: payload.release_sha });
    return { alerted: false, mark_deferred: false, failure_category };
  }
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
    ((dsn, event) => captureSentryEvent(dsn, event));

  // ---- SECRET-GATED BATCH DRAIN (the periodic drainer; the browser wake-hint is only best-effort).
  // reconcile → claim a batch → deliver each under its lease. This is what guarantees a crashed or
  // never-fired wake-hint cannot strand a report: the cron drains due/expired-lease alert rows. ----
  const providedDrainSecret = req.headers.get("x-alert-worker-secret");
  if (providedDrainSecret !== null) {
    const drainSecret = getEnv("ALERT_WORKER_SECRET") ?? getEnv("TELEMETRY_WORKER_SECRET");
    if (!drainSecret || providedDrainSecret !== drainSecret) return json(404, { error: { code: "not_found" } }, headers);
    const admin = createAdminClient();
    const dsn = getEnv("SENTRY_DSN");
    const windowSec = Number(getEnv("ALERT_RECONCILE_WINDOW_SECONDS") ?? "86400") || 86400;
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { error: recErr } = await admin.rpc("reconcile_report_alerts", { p_since: since });
    if (recErr) return json(500, { ok: false, result: "hard_failure", error: "reconcile_failed" }, headers);
    const { data: rows, error: claimErr } = await admin.rpc("claim_report_alert_batch", { p_limit: 50, p_worker: "report-alert-drain" });
    if (claimErr) return json(500, { ok: false, result: "hard_failure", error: "claim_failed" }, headers);
    const claimed = (rows ?? []) as Array<{ report_id: string; lease_token: string }>;
    const summary = { ok: true, result: "success", claimed: claimed.length, sent: 0, failed: 0, mark_deferred: 0 };
    for (const d of claimed) {
      const { data: report } = await admin.from("user_issue_reports").select(REPORT_SELECT).eq("id", d.report_id).maybeSingle();
      if (!report) continue; // FK cascade removes delivery rows for deleted reports; nothing to do
      const r = await deliverClaimed(admin, report as StoredReportRow, d.lease_token, dsn, sendSentry, logOps);
      if (r.alerted) summary.sent++; else if (r.mark_deferred) summary.mark_deferred++; else summary.failed++;
    }
    if (summary.failed > 0) { summary.result = "partial_retry"; }
    return json(200, summary, headers);
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

  // Scope: the caller may only alert their OWN report or an anonymous (null user_id) one.
  if (report.user_id && report.user_id !== user.id) {
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

  // Deliver under our lease via the shared helper (deterministic event_id; never alerted:true unless
  // the DB mark actually succeeded).
  const r = await deliverClaimed(admin, report as StoredReportRow, leaseToken as string, getEnv("SENTRY_DSN"), sendSentry, logOps);
  return json(200, {
    report_id: reportId,
    alerted: r.alerted,
    ...(r.mark_deferred ? { mark_deferred: true } : {}),
    ...(r.failure_category ? { failure_category: r.failure_category } : {}),
  }, headers);
}

if (import.meta.main) {
  Deno.serve((req: Request) => handler(req));
}
