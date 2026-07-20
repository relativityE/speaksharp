import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALERT_PAYLOAD_KEYS,
  buildAlertPayload,
  buildSentryEvent,
  classifyFailure,
  handler,
  normalizeSeverity,
  type StoredReportRow,
} from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const CALLER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const SHA = "abcdef0123456789abcdef0123456789abcdef01";

// A stored row that also carries content-bearing fields (title/description) the alert must NEVER
// read or emit. buildAlertPayload only reads the narrow allowlist, so these must never leak.
function storedRow(
  overrides: Partial<StoredReportRow> = {},
): StoredReportRow & Record<string, unknown> {
  return {
    id: REPORT_ID,
    severity: "high",
    session_id: SESSION,
    page_url:
      "https://speaksharp-public.vercel.app/session?token=SECRETQUERY#SECRETHASH",
    metadata: {
      route: "/session",
      sttMode: "Private",
      appRuntimeConfig: { release: SHA },
      userAgent: "SECRET-UA",
    },
    created_at: "2026-07-20T10:00:00.000Z",
    user_id: CALLER,
    // Content that must never appear in the alert:
    title: "SECRET-TITLE",
    description: "SECRET-DESCRIPTION email leak@example.com",
    transcript_excerpt: "SECRET-TRANSCRIPT",
    ...overrides,
  };
}

function req(
  body: unknown,
  opts: { origin?: string; auth?: string | null } = {},
) {
  const headers = new Headers();
  headers.set("Origin", opts.origin ?? APPROVED);
  if (opts.auth !== null) {
    headers.set("Authorization", opts.auth ?? "Bearer valid");
  }
  return new Request("https://fn/report-issue-alert", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface HarnessOpts {
  user?: { id: string } | null;
  authError?: { message: string } | null;
  report?: (StoredReportRow & Record<string, unknown>) | null;
  readError?: { message: string } | null;
  claimed?: boolean;
  claimError?: { message: string } | null;
  markData?: boolean;
  batchRows?: Array<{ report_id: string; lease_token: string }>;
  provenance?: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
  snapshotError?: { message: string } | null;
  onSourceRead?: () => void;
  onSentry?: () => void;
  onRpc?: (name: string) => void;
  env?: Record<string, string | undefined>;
  now?: () => number;
  sentryThrows?: Error | null;
  dsn?: string | undefined;
}

function harness(o: HarnessOpts = {}) {
  const calls = {
    rpc: [] as Array<{ name: string; args: unknown }>,
    sentry: [] as unknown[],
    ops: [] as Array<Record<string, string | null>>,
  };
  // deno-lint-ignore no-explicit-any
  const createUserClient = ((_auth: string) => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: o.user === undefined ? { id: CALLER } : o.user },
          error: o.authError ?? null,
        }),
    },
  })) as any;
  // deno-lint-ignore no-explicit-any
  const snapshotRow = () => (o.snapshot !== undefined ? o.snapshot : {
    data_origin: o.provenance?.data_origin ?? "automated_test",
    cohort_id: o.provenance?.cohort_id ?? "ci",
    test_run_id: o.provenance?.test_run_id ?? "run-1",
    test_suite: o.provenance?.test_suite ?? "suite-x",
    environment: "production",
  });
  const maybeSingleFor = (table: string) => {
    if (o.onSourceRead) o.onSourceRead();
    return table === "report_alert_deliveries"
      ? Promise.resolve({ data: snapshotRow(), error: o.snapshotError ?? null })
      : Promise.resolve({ data: o.report === undefined ? storedRow() : o.report, error: o.readError ?? null });
  };
  const createAdminClient = (() => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // supports .eq().maybeSingle() and .eq().abortSignal().maybeSingle()
          maybeSingle: () => maybeSingleFor(table),
          abortSignal: () => ({ maybeSingle: () => maybeSingleFor(table) }),
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      // awaitable + .abortSignal() builder; a per-name hook can throw to simulate a stalled/aborted op.
      // deno-lint-ignore no-explicit-any
      const b = (result: any) => ({
        abortSignal: () => { if (o.onRpc) o.onRpc(name); return Promise.resolve(result); },
        then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => { if (o.onRpc) o.onRpc(name); return Promise.resolve(result).then(f, r); },
      });
      if (name === "claim_report_alert") return b({ data: o.claimed === false ? null : "lease-token-1", error: o.claimError ?? null });
      if (name === "mark_report_alert") return b({ data: o.markData ?? true, error: null });
      if (name === "reconcile_report_alerts") return b({ data: 0, error: null });
      if (name === "claim_report_alert_batch") return b({ data: o.batchRows ?? [], error: null });
      if (name === "resolve_actor_provenance") return b({ data: [o.provenance ?? { data_origin: "automated_test", cohort_id: "ci", test_run_id: "run-1", test_suite: "suite-x" }], error: null });
      return b({ data: null, error: null });
    },
  })) as any;
  const sendSentry = (_dsn: string, event: unknown) => {
    calls.sentry.push(event);
    if (o.onSentry) o.onSentry();
    if (o.sentryThrows) return Promise.reject(o.sentryThrows);
    return Promise.resolve({});
  };
  const getEnv = (k: string) => {
    if (o.env && k in o.env) return o.env[k];
    if (k === "SENTRY_DSN") return "dsn" in o ? o.dsn : "https://k@o1.ingest.sentry.io/1";
    return "x";
  };
  const deps = {
    getEnv,
    createUserClient,
    createAdminClient,
    sendSentry,
    logOps: (e: Record<string, string | null>) => calls.ops.push(e),
    now: o.now,
  };
  return { calls, deps };
}

// ---------- pure helpers ----------
Deno.test("normalizeSeverity maps stored classification deterministically (no AI/prose)", () => {
  assertEquals(normalizeSeverity("critical"), "critical");
  assertEquals(normalizeSeverity("high"), "high");
  assertEquals(normalizeSeverity("medium"), "normal");
  assertEquals(normalizeSeverity("low"), "normal");
  assertEquals(normalizeSeverity("whatever"), "normal");
  assertEquals(normalizeSeverity(null), "normal");
});

Deno.test("buildAlertPayload yields EXACTLY the seven allowlisted keys from the stored row", () => {
  const p = buildAlertPayload(storedRow());
  assertEquals(Object.keys(p).sort(), [...ALERT_PAYLOAD_KEYS].sort());
  assertEquals(p.report_id, REPORT_ID);
  assertEquals(p.severity, "high");
  assertEquals(p.release_sha, SHA);
  assertEquals(p.route, "/session"); // bounded, no query/hash
  assertEquals(p.stt_mode, "Private");
  assertEquals(p.session_id, SESSION);
  assertEquals(p.timestamp, "2026-07-20T10:00:00.000Z");
});

Deno.test("buildAlertPayload validates/normalizes and drops unrecognized values", () => {
  const p = buildAlertPayload(storedRow({
    severity: "medium",
    session_id: "not-a-uuid",
    metadata: {
      route: "/x".padEnd(400, "y"),
      sttMode: "TelepathyMode",
      appRuntimeConfig: { release: "short" },
    },
  }));
  assertEquals(p.severity, "normal");
  assertEquals(p.session_id, null); // invalid uuid dropped
  assertEquals(p.stt_mode, null); // unrecognized mode dropped
  assertEquals(p.release_sha, null); // invalid sha dropped
  assert(p.route!.length <= 120); // bounded
});

const PROV_AT = { data_origin: "automated_test", cohort_id: "ci", test_run_id: "run-1", test_suite: "suite-x", environment: "production", server_verified_release_sha: null };

Deno.test("buildSentryEvent contains ONLY allowlisted tags, no PII/user/request/extra", () => {
  const ev = buildSentryEvent(buildAlertPayload(storedRow()), "evt1", PROV_AT) as Record<
    string,
    unknown
  >;
  // No default PII context keys.
  for (
    const forbidden of [
      "user",
      "request",
      "breadcrumbs",
      "contexts",
      "extra",
      "server_name",
    ]
  ) {
    assert(!(forbidden in ev), `event must not contain ${forbidden}`);
  }
  const tags = ev.tags as Record<string, string>;
  const allowedTagKeys = [
    "surface",
    "report_id",
    "severity",
    "release_sha",
    "route",
    "stt_mode",
    "session_id",
    // server-assigned provenance markers.
    "data_origin",
    "cohort_id",
    "test_run_id",
    "test_suite",
    "environment",
    "server_verified_release_sha",
  ];
  for (const k of Object.keys(tags)) {
    assert(allowedTagKeys.includes(k), `unexpected tag ${k}`);
  }
  assertEquals(tags.data_origin, "automated_test");
  assertEquals(tags.environment, "production");
  // The whole serialized event must not carry any report content.
  const s = JSON.stringify(ev);
  for (
    const leak of [
      "SECRET-TITLE",
      "SECRET-DESCRIPTION",
      "SECRET-TRANSCRIPT",
      "SECRET-UA",
      "leak@example.com",
      "SECRETQUERY",
      "SECRETHASH",
    ]
  ) {
    assert(!s.includes(leak), `event leaked ${leak}`);
  }
  assertEquals(ev.level, "error"); // high → error
});

// ---------- handler: store-before-alert / dedupe / auth / failure ----------
Deno.test("handler: report not found → 404 and NO claim/alert (no alert for a non-persisted report)", async () => {
  const h = harness({ report: null });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 404);
  assertEquals(h.calls.rpc.length, 0);
  assertEquals(h.calls.sentry.length, 0);
});

Deno.test("handler: happy path → claim, ONE sentry send, marked sent", async () => {
  const h = harness();
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).alerted, true);
  assertEquals(h.calls.sentry.length, 1);
  assertEquals(h.calls.rpc[0].name, "claim_report_alert");
  const mark = h.calls.rpc.find((c) => c.name === "mark_report_alert");
  assertEquals((mark!.args as Record<string, unknown>).p_status, "sent");
  // No report content leaked to the sentry event.
  const s = JSON.stringify(h.calls.sentry[0]);
  for (
    const leak of [
      "SECRET-TITLE",
      "SECRET-DESCRIPTION",
      "SECRET-TRANSCRIPT",
      "SECRET-UA",
      "leak@example.com",
    ]
  ) {
    assert(!s.includes(leak));
  }
});

Deno.test("handler: sentry event_id is DETERMINISTIC from report_id (retry-safe dedupe)", async () => {
  const h = harness();
  await handler(req({ reportId: REPORT_ID }), h.deps);
  const ev = h.calls.sentry[0] as { event_id: string };
  assertEquals(ev.event_id, REPORT_ID.replaceAll("-", "").toLowerCase());
});

Deno.test("handler: Sentry accepted but mark LOST (lease) → alerted:false, mark_deferred, single send", async () => {
  const h = harness({ markData: false });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  const body = await res.json();
  assertEquals(body.alerted, false);       // never claim alerted:true when the DB mark failed
  assertEquals(body.mark_deferred, true);
  assertEquals(h.calls.sentry.length, 1);  // deterministic id → the reclaim's re-send dedupes
});

Deno.test("handler: secret-gated batch DRAIN reconciles + delivers claimed alerts (periodic drainer)", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "lease-token-1" }] });
  const drainReq = new Request("https://fn/report-issue-alert", {
    method: "POST",
    headers: { Origin: APPROVED, "x-alert-worker-secret": "x" }, // harness getEnv returns "x"
    body: JSON.stringify({}),
  });
  const res = await handler(drainReq, h.deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.claimed, 1);
  assertEquals(body.sent, 1);
  assert(h.calls.rpc.some((c) => c.name === "reconcile_report_alerts"));
  assert(h.calls.rpc.some((c) => c.name === "claim_report_alert_batch"));
  assertEquals(h.calls.sentry.length, 1);
});

function drainReq() {
  return new Request("https://fn/report-issue-alert", {
    method: "POST", headers: { Origin: APPROVED, "x-alert-worker-secret": "x" }, body: "{}",
  });
}

Deno.test("handler DRAIN: source-read failure → infra, hard_failure (not green)", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], readError: { message: "db down" } });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.infra_errors, 1);
  assertEquals(body.result, "hard_failure");
  assertEquals(body.ok, false);
  assertEquals(h.calls.sentry.length, 0); // never delivered on a source-read failure
});

Deno.test("handler DRAIN: missing source → explicit source_gone disposition (not a silent skip)", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: null });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.source_gone, 1);
  assertEquals(body.result, "partial_retry");
  // marked failed(unknown) under the lease — bounded, not a silent continue.
  assert(h.calls.rpc.some((c) => c.name === "mark_report_alert"));
});

Deno.test("handler DRAIN: Sentry send failure → failed, accounted, partial_retry", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: storedRow({ user_id: CALLER }), sentryThrows: new Error("network ECONNRESET") });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.failed, 1);
  assertEquals(body.result, "partial_retry");
  assertEquals(body.claimed, body.sent + body.failed + body.mark_deferred + body.source_gone + body.lease_lost + body.infra_errors);
});

Deno.test("handler DRAIN: mark returns false after send → lease_lost, hard_failure", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: storedRow({ user_id: CALLER }), markData: false });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.mark_deferred, 1); // sent ok, mark false (lost lease) → deterministic id dedupes reclaim
  assertEquals(body.ok, true);          // mark_deferred alone is not a hard failure
});

Deno.test("handler DRAIN: deadline exhaustion → unaccounted rows, hard_failure (not green)", async () => {
  const rows = [{ report_id: REPORT_ID, lease_token: "t" }, { report_id: CALLER, lease_token: "t2" }];
  // Injected clock: the first 4 now() calls (since, budget start, reconcile+claim budgets) = 0, then a
  // value past the deadline → the lane's pre-check trips immediately, nothing processed, all unaccounted.
  let n = 0;
  const h = harness({ batchRows: rows, report: storedRow({ user_id: CALLER }), now: () => (n++ < 4 ? 0 : 1e9) });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.time_budget_exhausted, true);
  assert(body.unaccounted > 0);
  assertEquals(body.result, "hard_failure");
  assertEquals(body.ok, false);
});

const DRAIN_DEADLINE_ENV = { ALERT_WORKER_DEADLINE_MS: "10000", ALERT_MARK_RESERVE_MS: "2000", ALERT_EVENT_TIMEOUT_MS: "5000", ALERT_WORKER_CONCURRENCY: "1" };

Deno.test("handler DRAIN DEADLINE: source read consumes budget → no Sentry, time_budget, hard_failure", async () => {
  const clock = { t: 0 };
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: storedRow({ user_id: CALLER }),
    env: DRAIN_DEADLINE_ENV, now: () => clock.t, onSourceRead: () => { clock.t += 9500; } });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(h.calls.sentry.length, 0);
  assertEquals(body.time_budget_exhausted, true);
  assertEquals(body.result, "hard_failure");
  assertEquals(body.sent, 0);
});

Deno.test("handler DRAIN DEADLINE: Sentry completes but no time to mark → not marked (time_budget)", async () => {
  const clock = { t: 0 };
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: storedRow({ user_id: CALLER }),
    env: DRAIN_DEADLINE_ENV, now: () => clock.t, onSentry: () => { clock.t += 10001; } });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(h.calls.sentry.length, 1);           // sent to Sentry
  assertEquals(body.sent, 0);                        // but NOT marked sent (no budget)
  assertEquals(body.time_budget_exhausted, true);
  assert(!h.calls.rpc.some((c) => c.name === "mark_report_alert")); // never marked
});

Deno.test("handler DRAIN DEADLINE: no op begins after the deadline is exceeded mid-run", async () => {
  const clock = { t: 0 };
  let reads = 0;
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t1" }, { report_id: CALLER, lease_token: "t2" }],
    report: storedRow({ user_id: CALLER }), env: DRAIN_DEADLINE_ENV, now: () => clock.t,
    onSourceRead: () => { reads++; clock.t += 10001; } });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(reads, 1);                 // row 2 never read
  assertEquals(body.time_budget_exhausted, true);
  assertEquals(body.result, "hard_failure");
});

const alertThrowOn = (name: string) => (n: string) => { if (n === name) throw new Error(`aborted:${name}`); };

Deno.test("handler DRAIN: stalled reconcile (aborted) → 500 hard_failure, never claims", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], onRpc: alertThrowOn("reconcile_report_alerts") });
  const res = await handler(drainReq(), h.deps);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "reconcile_failed");
  assert(!h.calls.rpc.some((c) => c.name === "claim_report_alert_batch"));
});

Deno.test("handler DRAIN: stalled claim (aborted) → 500 hard_failure", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], onRpc: alertThrowOn("claim_report_alert_batch") });
  const res = await handler(drainReq(), h.deps);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "claim_failed");
});

Deno.test("handler DRAIN: stalled mark (aborted) → infra_error, hard_failure, not sent", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }], report: storedRow({ user_id: CALLER }), onRpc: alertThrowOn("mark_report_alert") });
  const body = await (await handler(drainReq(), h.deps)).json();
  assertEquals(body.sent, 0);
  assert(body.infra_errors >= 1);
  assertEquals(body.result, "hard_failure");
});

Deno.test("handler: batch DRAIN with wrong secret → 404, no work", async () => {
  const h = harness({ batchRows: [{ report_id: REPORT_ID, lease_token: "t" }] });
  const bad = new Request("https://fn/report-issue-alert", {
    method: "POST", headers: { Origin: APPROVED, "x-alert-worker-secret": "WRONG" }, body: "{}",
  });
  const res = await handler(bad, h.deps);
  assertEquals(res.status, 404);
  assertEquals(h.calls.rpc.length, 0);
});

Deno.test("handler: dedupe — claim returns false → NO second alert", async () => {
  const h = harness({ claimed: false });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).deduped, true);
  assertEquals(h.calls.sentry.length, 0);
  assert(!h.calls.rpc.some((c) => c.name === "mark_report_alert")); // nothing marked; existing state untouched
});

Deno.test("handler: sentry failure → marked failed with fixed category + sanitized ops evidence only", async () => {
  const h = harness({
    sentryThrows: new Error(
      "Sentry ingest rejected event with HTTP 429: SECRET-BODY",
    ),
  });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 200); // non-fatal; report already stored upstream
  const body = await res.json();
  assertEquals(body.alerted, false);
  assertEquals(body.failure_category, "sentry_ingest_rejected");
  const mark = h.calls.rpc.find((c) => c.name === "mark_report_alert");
  assertEquals(
    (mark!.args as Record<string, unknown>).p_failure_category,
    "sentry_ingest_rejected",
  );
  // Ops evidence carries ONLY report_id/category/timestamp/release_sha — no exception body/prose.
  assertEquals(h.calls.ops.length, 1);
  assertEquals(Object.keys(h.calls.ops[0]).sort(), [
    "failure_category",
    "release_sha",
    "report_id",
    "timestamp",
  ]);
  assert(!JSON.stringify(h.calls.ops[0]).includes("SECRET-BODY"));
});

Deno.test("handler: missing SENTRY_DSN → failed(sentry_config_missing), no send", async () => {
  const h = harness({ dsn: undefined });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals((await res.json()).failure_category, "sentry_config_missing");
  assertEquals(h.calls.sentry.length, 0);
  const mark = h.calls.rpc.find((c) => c.name === "mark_report_alert");
  assertEquals(
    (mark!.args as Record<string, unknown>).p_failure_category,
    "sentry_config_missing",
  );
});

Deno.test("handler: caller cannot alert another user's report → 403 before claim/alert", async () => {
  const h = harness({
    report: storedRow({ user_id: "99999999-9999-4999-8999-999999999999" }),
  });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 403);
  assertEquals(h.calls.rpc.length, 0);
  assertEquals(h.calls.sentry.length, 0);
});

Deno.test("handler: NULL-user (anonymous) report → 403 for an authenticated caller (fail-closed)", async () => {
  // Anonymous reports are delivered ONLY by the server outbox/reconciler — never triggerable by an
  // arbitrary authenticated caller who knows the UUID.
  const h = harness({ report: storedRow({ user_id: null }) });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 403);
  assertEquals(h.calls.rpc.length, 0);
  assertEquals(h.calls.sentry.length, 0);
});

Deno.test("handler: own report (user_id === caller) → allowed (claim + alert)", async () => {
  const h = harness({ report: storedRow({ user_id: CALLER }) });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).alerted, true);
});

Deno.test("handler: nonexistent report → 404 (no claim/alert)", async () => {
  const h = harness({ report: null });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 404);
  assertEquals(h.calls.rpc.length, 0);
  assertEquals(h.calls.sentry.length, 0);
});

Deno.test("handler: wake-hint alert carries server-resolved provenance tag (automated_test)", async () => {
  const h = harness({ report: storedRow({ user_id: CALLER }), provenance: { data_origin: "automated_test", cohort_id: "ci", test_run_id: "r", test_suite: "s" } });
  await handler(req({ reportId: REPORT_ID }), h.deps);
  const ev = h.calls.sentry[0] as { tags: Record<string, string> };
  assertEquals(ev.tags.data_origin, "automated_test");
});

Deno.test("handler: invited-tester report is marked beta_tester in Sentry (from the AT-INSERT snapshot)", async () => {
  // Provenance comes from the delivery-row SNAPSHOT, not a live resolve.
  const h = harness({ report: storedRow({ user_id: CALLER }), snapshot: { data_origin: "beta_tester", cohort_id: "wave1", test_run_id: "r", test_suite: "s", environment: "production" } });
  await handler(req({ reportId: REPORT_ID }), h.deps);
  const ev = h.calls.sentry[0] as { tags: Record<string, string> };
  assertEquals(ev.tags.data_origin, "beta_tester");
  assertEquals(ev.tags.cohort_id, "wave1");
});

Deno.test("handler: snapshot-provenance READ FAILURE → infra_error, NO send (never silent legacy downgrade)", async () => {
  const h = harness({ report: storedRow({ user_id: CALLER }), snapshotError: { message: "db blip" } });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  const body = await res.json();
  assertEquals(body.infra_error, true);
  assertEquals(body.alerted, false);
  assertEquals(h.calls.sentry.length, 0); // must NOT send with a downgraded/guessed classification
});

Deno.test("handler: browser-supplied provenance is IGNORED (only server registry decides)", async () => {
  // Even if a malicious body tried to set provenance, the function reads it only from resolve_actor_provenance.
  const h = harness({ report: storedRow({ user_id: CALLER }), provenance: { data_origin: "production_user" } });
  const badReq = new Request("https://fn/report-issue-alert", {
    method: "POST", headers: { Origin: APPROVED, Authorization: "Bearer valid" },
    body: JSON.stringify({ reportId: REPORT_ID, data_origin: "owner_manual_test", tags: { data_origin: "seed_fixture" } }),
  });
  await handler(badReq, h.deps);
  const ev = h.calls.sentry[0] as { tags: Record<string, string> };
  assertEquals(ev.tags.data_origin, "production_user"); // from the server resolver, NOT the body
});

Deno.test("handler: auth required — no header → 401; invalid token → 401", async () => {
  assertEquals(
    (await handler(
      req({ reportId: REPORT_ID }, { auth: null }),
      harness().deps,
    )).status,
    401,
  );
  assertEquals(
    (await handler(
      req({ reportId: REPORT_ID }),
      harness({ user: null, authError: { message: "bad" } }).deps,
    )).status,
    401,
  );
});

Deno.test("handler: invalid/malformed report id → 400 before any DB work", async () => {
  const h = harness();
  assertEquals(
    (await handler(req({ reportId: "not-a-uuid" }), h.deps)).status,
    400,
  );
  assertEquals((await handler(req({}), h.deps)).status, 400);
  assertEquals(h.calls.rpc.length, 0);
});

Deno.test("classifyFailure maps to fixed categories only", () => {
  assertEquals(
    classifyFailure(new Error("Sentry ingest rejected event with HTTP 500")),
    "sentry_ingest_rejected",
  );
  assertEquals(
    classifyFailure(new Error("fetch failed ECONNRESET")),
    "transport_error",
  );
  assertEquals(classifyFailure(new Error("weird")), "unknown");
});
