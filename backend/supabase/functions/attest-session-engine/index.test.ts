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
function serviceClientFactory(opts: { challenge?: string | null; version?: string | null; attestErr?: string; challengeErr?: string }): any {
  return () => ({
    rpc: (name: string) => {
      if (name === "issue_attribution_challenge_v1") {
        return Promise.resolve(opts.challengeErr
          ? { data: null, error: { message: opts.challengeErr } }
          : { data: opts.challenge ?? "c1", error: null });
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
  assertEquals(await res.json(), { attributed: true, authority_version: "attrib_v1" });
});

Deno.test("attest rejected (evidence gate) → 422 fail-closed", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: { ...GOOD, cloud_used: true } }),
    userClientFactory({}),
    serviceClientFactory({ attestErr: "attribution: cloud used" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Attestation rejected", attributed: false });
});

Deno.test("ownership read error → 500", async () => {
  const res = await handler(request({ sessionId: SESSION, runtimeEvidence: GOOD }), userClientFactory({ ownErr: true }), serviceClientFactory({}));
  assertEquals(res.status, 500);
});

Deno.test("swap-denied RPC rejection → 422 fail-closed (Browser→Private etc.)", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: { ...GOOD, provider: "transformers-js" } }),
    userClientFactory({}),
    serviceClientFactory({ attestErr: "attribution: evidence class private contradicts the persisted engine class browser — swap denied" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Attestation rejected", attributed: false });
});

Deno.test("non-completed session RPC rejection → 422 fail-closed (terminal gate)", async () => {
  const res = await handler(
    request({ sessionId: SESSION, runtimeEvidence: GOOD }),
    userClientFactory({}),
    serviceClientFactory({ attestErr: "attribution: session is not durably completed (status=pending)" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Attestation rejected", attributed: false });
});

Deno.test("register op → 200 registered (freezes pre-recording class/model)", async () => {
  const res = await handler(
    request({ op: "register", sessionId: SESSION, engineClass: "private", expectedModel: "base" }),
    userClientFactory({}),
    serviceClientFactory({ challenge: "c1" }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { registered: true });
});

Deno.test("register op with invalid engineClass → 400", async () => {
  const res = await handler(
    request({ op: "register", sessionId: SESSION, engineClass: "cloud" }),
    userClientFactory({}),
    serviceClientFactory({}),
  );
  assertEquals(res.status, 400);
});

Deno.test("register op rejected by RPC (blank Private model) → 422", async () => {
  const res = await handler(
    request({ op: "register", sessionId: SESSION, engineClass: "private", expectedModel: "" }),
    userClientFactory({}),
    serviceClientFactory({ challengeErr: "a Private challenge requires a non-blank model provenance" }),
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Registration rejected", registered: false });
});

Deno.test("register op on a non-owned session → 403", async () => {
  const res = await handler(
    request({ op: "register", sessionId: SESSION, engineClass: "private", expectedModel: "base" }),
    userClientFactory({ owned: false }),
    serviceClientFactory({}),
  );
  assertEquals(res.status, 403);
});
