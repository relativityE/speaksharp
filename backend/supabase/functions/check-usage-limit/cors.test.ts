import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "http://localhost:5174";
const HOSTILE = "http://localhost.example.com:5174";

function req(method: string, origin?: string, authHeader?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://fn/check-usage-limit", { method, headers });
}

function spy() {
  const calls = { createSupabase: 0 };
  // deno-lint-ignore no-explicit-any
  const createSupabase = (_auth: string | null) => {
    calls.createSupabase++;
    return {
      rpc: () => Promise.resolve({ data: { can_start: true }, error: null }),
    } as any;
  };
  return { calls, createSupabase };
}

Deno.test("check-usage-limit CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const s = spy();
  const res = await handler(req("OPTIONS", APPROVED), s.createSupabase);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(s.calls.createSupabase, 0);
});

Deno.test("check-usage-limit CORS: hostile OPTIONS → 403, no ACAO", async () => {
  const s = spy();
  const res = await handler(req("OPTIONS", HOSTILE), s.createSupabase);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(s.calls.createSupabase, 0);
});

Deno.test("check-usage-limit CORS: hostile normal → 403 BEFORE Supabase/RPC", async () => {
  const s = spy();
  const res = await handler(req("POST", HOSTILE, "Bearer x"), s.createSupabase);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  assertEquals(s.calls.createSupabase, 0); // zero downstream
});

Deno.test("check-usage-limit CORS: approved origin retains exact ACAO on its own auth error", async () => {
  const s = spy();
  const res = await handler(req("POST", APPROVED), s.createSupabase); // no auth
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assert(res.status === 401 || res.status === 400);
});

Deno.test("check-usage-limit CORS: no-Origin request not CORS-rejected, no fabricated ACAO", async () => {
  const s = spy();
  const res = await handler(req("POST", undefined), s.createSupabase);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assert(
    res.status !== 403 ||
      (await res.clone().json()).error?.code !== "origin_not_allowed",
  );
});
