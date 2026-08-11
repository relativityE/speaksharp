import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const HOSTILE = "https://www.example.com.evil.com";

function req(method: string, origin?: string, authHeader?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://fn/get-ai-suggestions", { method, headers });
}

function spy() {
  const calls = { createSupabase: 0 };
  // deno-lint-ignore no-explicit-any
  const createSupabase = (_auth: string | null) => {
    calls.createSupabase++;
    return {
      from: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    } as any;
  };
  return { calls, createSupabase };
}

Deno.test("get-ai-suggestions CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const s = spy();
  const res = await handler(req("OPTIONS", APPROVED), s.createSupabase);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(s.calls.createSupabase, 0);
});

Deno.test("get-ai-suggestions CORS: hostile OPTIONS → 403, no ACAO", async () => {
  const s = spy();
  const res = await handler(req("OPTIONS", HOSTILE), s.createSupabase);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(s.calls.createSupabase, 0);
});

Deno.test("get-ai-suggestions CORS: hostile normal → 403 BEFORE Supabase/AI", async () => {
  const s = spy();
  const res = await handler(req("POST", HOSTILE, "Bearer x"), s.createSupabase);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  assertEquals(s.calls.createSupabase, 0);
});

Deno.test("get-ai-suggestions CORS: approved origin retains exact ACAO on its auth error", async () => {
  const s = spy();
  const res = await handler(req("POST", APPROVED), s.createSupabase);
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(s.calls.createSupabase, 1); // reached its own logic for an approved origin
});

Deno.test("get-ai-suggestions CORS: no-Origin not CORS-rejected, no fabricated ACAO", async () => {
  const s = spy();
  const res = await handler(req("POST", undefined), s.createSupabase);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assert((await res.json()).error !== "origin_not_allowed");
});
