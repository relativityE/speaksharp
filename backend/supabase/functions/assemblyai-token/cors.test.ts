import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const HOSTILE = "https://speaksharp.ai.evil.com";

function req(method: string, origin?: string, authHeader?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://fn/assemblyai-token", { method, headers });
}

// Spies: any invocation means the CORS guard failed to reject before side effects.
function spies() {
  const calls = { createSupabase: 0, fetch: 0, getEnv: 0 };
  const createSupabase = () => {
    calls.createSupabase++;
    throw new Error("createSupabase must not run for a hostile origin");
  };
  const fetchImpl = (() => {
    calls.fetch++;
    return Promise.reject(new Error("fetch must not run for a hostile origin"));
  }) as unknown as typeof fetch;
  const getEnv = (k: string) => {
    calls.getEnv++;
    return k === "ASSEMBLYAI_API_KEY" ? "test-key" : undefined;
  };
  return { calls, createSupabase, fetchImpl, getEnv };
}

Deno.test("assemblyai-token CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const s = spies();
  const res = await handler(
    req("OPTIONS", APPROVED),
    s.createSupabase,
    s.fetchImpl,
    s.getEnv,
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(s.calls.createSupabase, 0);
  assertEquals(s.calls.fetch, 0);
});

Deno.test("assemblyai-token CORS: hostile OPTIONS → 403, no ACAO, zero downstream", async () => {
  const s = spies();
  const res = await handler(
    req("OPTIONS", HOSTILE),
    s.createSupabase,
    s.fetchImpl,
    s.getEnv,
  );
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(s.calls.createSupabase, 0);
  assertEquals(s.calls.fetch, 0);
});

Deno.test("assemblyai-token CORS: hostile normal request → 403 BEFORE auth/provider/db", async () => {
  const s = spies();
  const res = await handler(
    req("POST", HOSTILE, "Bearer x"),
    s.createSupabase,
    s.fetchImpl,
    s.getEnv,
  );
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  // Proof: no Supabase client, no AssemblyAI fetch, not even an env read for the key.
  assertEquals(s.calls.createSupabase, 0);
  assertEquals(s.calls.fetch, 0);
  assertEquals(s.calls.getEnv, 0);
});

Deno.test("assemblyai-token CORS: approved origin retains exact ACAO on its own auth error", async () => {
  const s = spies();
  // Approved origin, missing Authorization → the function's own 401 (not a CORS 403).
  const res = await handler(
    req("POST", APPROVED),
    s.createSupabase,
    s.fetchImpl,
    s.getEnv,
  );
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(s.calls.createSupabase, 0); // returns before building the client
});

Deno.test("assemblyai-token CORS: no-Origin request is not CORS-rejected, no fabricated ACAO", async () => {
  const s = spies();
  const res = await handler(
    req("POST", undefined),
    s.createSupabase,
    s.fetchImpl,
    s.getEnv,
  );
  // Reaches its own auth (401 missing header) rather than a 403 origin rejection.
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null); // no fabricated ACAO
});
