import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const SESSION = "5a344bc2-4c46-469b-bf4d-80afce5f8121";

function request(body?: unknown, authHeader: string | null = "Bearer token"): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  return new Request("http://localhost/objective-register-source", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function userClientFactory(opts: {
  user?: { id: string } | null;
  capable?: boolean; capErr?: boolean;
  owned?: boolean; ownErr?: boolean;
}): any {
  return () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user }, error: opts.user === null ? { message: "no session" } : null }) },
    rpc: (name: string) => {
      if (name === "has_objective_capability") {
        return Promise.resolve(opts.capErr
          ? { data: null, error: { message: "boom" } }
          : { data: opts.capable ?? true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
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
function serviceClientFactory(opts: { registered?: string | null; regErr?: string }): any {
  return () => ({
    rpc: (name: string) => {
      if (name === "objective_register_source_v1") {
        return Promise.resolve(opts.regErr
          ? { data: null, error: { message: opts.regErr } }
          : { data: opts.registered === undefined ? SESSION : opts.registered, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  });
}

Deno.test("missing Authorization → 401", async () => {
  const res = await handler(request({ sessionId: SESSION }, null), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 401);
});

Deno.test("unauthorized user → 401", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({ user: null }), serviceClientFactory({}));
  assertEquals(res.status, 401);
});

Deno.test("invalid JSON body → 400", async () => {
  const bad = new Request("http://localhost/objective-register-source", {
    method: "POST", headers: { Authorization: "Bearer token" }, body: "{not json",
  });
  const res = await handler(bad, userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 400);
});

Deno.test("non-UUID sessionId → 400", async () => {
  const res = await handler(request({ sessionId: "nope" }), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 400);
});

Deno.test("capability check error → 500", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({ capErr: true }), serviceClientFactory({}));
  assertEquals(res.status, 500);
});

Deno.test("not objective-capable → 403", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({ capable: false }), serviceClientFactory({}));
  assertEquals(res.status, 403);
});

Deno.test("ownership read error → 500", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({ ownErr: true }), serviceClientFactory({}));
  assertEquals(res.status, 500);
});

Deno.test("not the caller's recording → 403", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({ owned: false }), serviceClientFactory({}));
  assertEquals(res.status, 403);
});

Deno.test("recording not eligible (RPC rejects) → 422", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({}), serviceClientFactory({ regErr: "not a verified Private engine" }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).registered, false);
});

Deno.test("recording not eligible (RPC returns null) → 422", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({}), serviceClientFactory({ registered: null }));
  assertEquals(res.status, 422);
});

Deno.test("happy path → 200 registered:true", async () => {
  const res = await handler(request({ sessionId: SESSION }), userClientFactory({}), serviceClientFactory({}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).registered, true);
});
