import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "http://127.0.0.1:5173";
const HOSTILE = "http://127.0.0.1.example.com:5173";

function req(method: string, origin?: string, authHeader?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://fn/stripe-billing-portal", { method, headers });
}

function deps() {
  const calls = { getEnv: 0, createSupabase: 0 };
  const env: Record<string, string> = {
    SITE_URL: "https://site.example",
    STRIPE_SECRET_KEY: "sk_test_x",
  };
  const getEnv = (k: string) => {
    calls.getEnv++;
    return env[k];
  };
  // deno-lint-ignore no-explicit-any
  const stripeClient = {} as any;
  // deno-lint-ignore no-explicit-any
  const createSupabase = (() => {
    calls.createSupabase++;
    throw new Error("supabase must not run");
  }) as any;
  return { calls, deps: { getEnv, stripeClient, createSupabase } };
}

Deno.test("stripe-billing-portal CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", APPROVED), d.deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("stripe-billing-portal CORS: hostile OPTIONS → 403, no ACAO", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", HOSTILE), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("stripe-billing-portal CORS: hostile normal → 403 BEFORE config/auth/Supabase", async () => {
  const d = deps();
  const res = await handler(req("POST", HOSTILE, "Bearer x"), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  assertEquals(d.calls.getEnv, 0); // rejected before any env read
  assertEquals(d.calls.createSupabase, 0);
});

Deno.test("stripe-billing-portal CORS: approved origin retains exact ACAO on its own auth error", async () => {
  const d = deps();
  const res = await handler(req("POST", APPROVED), d.deps); // no auth header
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(d.calls.createSupabase, 0);
});

Deno.test("stripe-billing-portal CORS: no-Origin not CORS-rejected, no fabricated ACAO", async () => {
  const d = deps();
  const res = await handler(req("POST", undefined), d.deps);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assert((await res.json()).error.code !== "origin_not_allowed");
});
