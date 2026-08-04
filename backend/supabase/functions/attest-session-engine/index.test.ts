import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const SESSION = "5a344bc2-4c46-469b-bf4d-80afce5f8121";
const GOOD = { provider: "transformers-js", model_id: "base", fallback_occurred: false, cloud_used: false };

function request(body?: unknown, authHeader: string | null = "Bearer token"): Request {
  return new Request("http://localhost/attest-session-engine", {
    method: "POST",
    headers: authHeader ? { Authorization: authHeader } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function userClientFactory(opts: { user?: { id: string } | null; owned?: boolean; ownErr?: boolean }): any {
  return () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user ?? { id: "u1" } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(
            opts.ownErr
              ? { data: null, error: { message: "boom" } }
              : { data: opts.owned === false ? null : { id: SESSION }, error: null },
          ),
        }),
      }),
    }),
  });
}

// deno-lint-ignore no-explicit-any
function serviceClientFactory(opts: { challenge?: string | null; version?: string | null; attestErr?: string; challengeErr?: string; bound?: string | null; bindErr?: string }): any {
  return () => ({
    rpc: (name: string) => {
      if (name === "issue_attribution_intent_v1") {
        return Promise.resolve(opts.challengeErr
          ? { data: null, error: { message: opts.challengeErr } }
          : { data: opts.challenge ?? "c1", error: null });
      }
      if (name === "bind_attribution_intent_v1") {
        return Promise.resolve(opts.bindErr
          ? { data: null, error: { message: opts.bindErr } }
          : { data: opts.bound === undefined ? "c1" : opts.bound, error: null });
      }
      return Promise.resolve(opts.attestErr
        ? { data: null, error: { message: opts.attestErr } }
        : { data: opts.version ?? "attrib_v1", error: null });
    },
  });
}

const unauthUser = () => ({
  auth: { getUser: () => Promise.resolve({ data: { user: null }, error: { message: "no session" } }) },
  // deno-lint-ignore no-explicit-any
}) as any;

Deno.test("missing Authorization → 401", async () => {
  const res = await handler(request(GOOD, null), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 401);
});

Deno.test("unauthorized user → 401", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: GOOD }), () => unauthUser(), serviceClientFactory({}));
  assertEquals(res.status, 401);
});

Deno.test("invalid JSON body → 400", async () => {
  const bad = new Request("http://localhost/attest-session-engine", {
    method: "POST", headers: { Authorization: "Bearer t" }, body: "{not json",
  });
  const res = await handler(bad, userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 400);
});

Deno.test("non-UUID sessionId → 400", async () => {
  const res = await handler(request({ sessionId: "nope", runtimeEvidence: GOOD }), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 400);
});

Deno.test("non-object runtimeEvidence → 400", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: "x" }), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 400);
});

Deno.test("session not owned → 403", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: GOOD }), userClientFactory({ owned: false }), serviceClientFactory({}));
  assertEquals(res.status, 403);
});

Deno.test("happy path → 200 attributed attrib_v1", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: GOOD }), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { attributed: true, resolved: true, authority_version: "attrib_v1" });
});

Deno.test("definitive rejection (evidence gate) → 200 terminally UNATTRIBUTED (not an error)", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: { ...GOOD, cloud_used: true } }),
    userClientFactory({}),
    serviceClientFactory({ version: "unattributed" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { attributed: false, resolved: true });
});

Deno.test("ownership read error → 500", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: GOOD }), userClientFactory({ ownErr: true }), serviceClientFactory({}));
  assertEquals(res.status, 500);
});

Deno.test("swap-denied → 200 terminally UNATTRIBUTED (Browser→Private etc.)", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: { ...GOOD, provider: "transformers-js" } }),
    userClientFactory({}),
    serviceClientFactory({ version: "unattributed" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { attributed: false, resolved: true });
});

Deno.test("non-completed session → 503 TRANSIENT (terminal gate; retryable, not resolved)", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: GOOD }),
    userClientFactory({}),
    serviceClientFactory({ attestErr: "attribution: session is not durably completed (status=pending)" }),
  );
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: "Attestation deferred", attributed: false, resolved: false });
});

Deno.test("register op → 200 registered (PRE-SESSION intent, keyed on recordingKey, no session)", async () => {
  const res = await handler(
    request({ op: "register", recordingKey: "rec-1", engineClass: "private", expectedModel: "base" }),
    userClientFactory({}),
    serviceClientFactory({ challenge: "c1" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { registered: true });
});

Deno.test("register op with a blank recordingKey → 400", async () => {
  const res = await handler(
    request({ op: "register", recordingKey: "  ", engineClass: "private", expectedModel: "base" }),
    userClientFactory({}),
    serviceClientFactory({}),
  );
  assertEquals(res.status, 400);
});

Deno.test("register op with invalid engineClass → 400", async () => {
  const res = await handler(
    request({ op: "register", recordingKey: "rec-1", engineClass: "cloud" }),
    userClientFactory({}),
    serviceClientFactory({}),
  );
  assertEquals(res.status, 400);
});

Deno.test("register op rejected by RPC (blank Private model) → 422", async () => {
  const res = await handler(
    request({ op: "register", recordingKey: "rec-1", engineClass: "private", expectedModel: "" }),
    userClientFactory({}),
    serviceClientFactory({ challengeErr: "a Private intent requires a non-blank model provenance" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Registration rejected", registered: false });
});

Deno.test("bind op → 200 bound (atomically binds the intent to the produced session)", async () => {
  const res = await handler(
    request({ op: "bind", sessionId: SESSION, recordingKey: "rec-1" }),
    userClientFactory({}),
    serviceClientFactory({ bound: "c1" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { bound: true });
});

Deno.test("bind op with no matching/expired intent → 200 bound:false (not an error)", async () => {
  const res = await handler(
    request({ op: "bind", sessionId: SESSION, recordingKey: "rec-x" }),
    userClientFactory({}),
    serviceClientFactory({ bound: null }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { bound: false });
});

Deno.test("bind op on a non-owned session → 403", async () => {
  const res = await handler(
    request({ op: "bind", sessionId: SESSION, recordingKey: "rec-1" }),
    userClientFactory({ owned: false }),
    serviceClientFactory({}),
  );
  assertEquals(res.status, 403);
});

Deno.test("bind op rejected by RPC (non-pre-recording lifecycle) → 422", async () => {
  const res = await handler(
    request({ op: "bind", sessionId: SESSION, recordingKey: "rec-1" }),
    userClientFactory({}),
    serviceClientFactory({ bindErr: "session is not in the pre-recording state — binding denied" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Bind rejected", bound: false });
});
