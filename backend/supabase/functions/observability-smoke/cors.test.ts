import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp.ai";
const HOSTILE = "https://speaksharp.ai.evil.com";

function req(method: string, origin?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  return new Request("https://fn/observability-smoke", { method, headers });
}

Deno.test("observability-smoke CORS: hostile browser Origin → 403 BEFORE the secret check", async () => {
  const res = await handler(req("POST", HOSTILE));
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
});

Deno.test("observability-smoke CORS: no-Origin automation request reaches its own secret gate (not CORS 403)", async () => {
  const res = await handler(req("POST", undefined));
  // Missing/invalid smoke secret → its own 404 ('not_found'), NOT a CORS 403.
  assert(res.status !== 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null); // no fabricated ACAO
});

Deno.test("observability-smoke CORS: approved OPTIONS → 204 + exact ACAO; hostile OPTIONS → 403", async () => {
  const ok = await handler(req("OPTIONS", APPROVED));
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(ok.headers.get("Vary"), "Origin");

  const hostile = await handler(req("OPTIONS", HOSTILE));
  assertEquals(hostile.status, 403);
  assertEquals(hostile.headers.get("Access-Control-Allow-Origin"), null);
});
