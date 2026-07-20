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
  const createAdminClient = (() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: o.report === undefined ? storedRow() : o.report,
              error: o.readError ?? null,
            }),
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (name === "claim_report_alert") {
        return Promise.resolve({
          data: o.claimed ?? true,
          error: o.claimError ?? null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  })) as any;
  const sendSentry = (_dsn: string, event: unknown) => {
    calls.sentry.push(event);
    if (o.sentryThrows) return Promise.reject(o.sentryThrows);
    return Promise.resolve({});
  };
  const getEnv = (
    k: string,
  ) => (k === "SENTRY_DSN"
    ? ("dsn" in o ? o.dsn : "https://k@o1.ingest.sentry.io/1")
    : "x");
  const deps = {
    getEnv,
    createUserClient,
    createAdminClient,
    sendSentry,
    logOps: (e: Record<string, string | null>) => calls.ops.push(e),
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

Deno.test("buildSentryEvent contains ONLY allowlisted tags, no PII/user/request/extra", () => {
  const ev = buildSentryEvent(buildAlertPayload(storedRow()), "evt1") as Record<
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
  ];
  for (const k of Object.keys(tags)) {
    assert(allowedTagKeys.includes(k), `unexpected tag ${k}`);
  }
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

Deno.test("handler: anonymous report (null user_id) is alertable by an authenticated caller", async () => {
  const h = harness({ report: storedRow({ user_id: null }) });
  const res = await handler(req({ reportId: REPORT_ID }), h.deps);
  assertEquals(res.status, 200);
  assertEquals(h.calls.sentry.length, 1);
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
