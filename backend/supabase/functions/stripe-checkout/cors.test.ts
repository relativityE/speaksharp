import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const HOSTILE = "https://speaksharp-public.vercel.app.evil.com";

function req(method: string, origin?: string, authHeader?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (authHeader) headers.set("Authorization", authHeader);
  return new Request("https://fn/stripe-checkout", { method, headers });
}

function deps() {
  const calls = { getEnv: 0, stripe: 0, createSupabase: 0 };
  // Payments intentionally left disabled (fail-closed) — getEnv returns nothing.
  const getEnv = (_k: string) => {
    calls.getEnv++;
    return undefined;
  };
  // deno-lint-ignore no-explicit-any
  const stripeClient = new Proxy({}, {
    get: () => () => {
      calls.stripe++;
      throw new Error("stripe must not run");
    },
  }) as any;
  // deno-lint-ignore no-explicit-any
  const createSupabase = (() => {
    calls.createSupabase++;
    throw new Error("supabase must not run");
  }) as any;
  return { calls, deps: { getEnv, stripeClient, createSupabase } };
}

Deno.test("stripe-checkout CORS: approved OPTIONS → 204 + exact ACAO + Vary", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", APPROVED), d.deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(d.calls.stripe, 0);
  assertEquals(d.calls.createSupabase, 0);
});

Deno.test("stripe-checkout CORS: hostile OPTIONS → 403, no ACAO", async () => {
  const d = deps();
  const res = await handler(req("OPTIONS", HOSTILE), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("stripe-checkout CORS: hostile normal → 403 BEFORE payments/auth/Stripe/Supabase", async () => {
  const d = deps();
  const res = await handler(req("POST", HOSTILE, "Bearer x"), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  // Proof: not even the payments-enabled env read ran, no Stripe, no Supabase.
  assertEquals(d.calls.getEnv, 0);
  assertEquals(d.calls.stripe, 0);
  assertEquals(d.calls.createSupabase, 0);
});

Deno.test("stripe-checkout CORS: approved origin still fail-closed (payments_disabled) with exact ACAO", async () => {
  const d = deps();
  const res = await handler(req("POST", APPROVED, "Bearer x"), d.deps);
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals((await res.json()).error.code, "payments_disabled");
  // Billing stays closed for approved origins too; no Stripe session created.
  assert(d.calls.getEnv >= 1);
  assertEquals(d.calls.stripe, 0);
});

Deno.test("stripe-checkout CORS: no-Origin request not CORS-rejected (reaches fail-closed billing)", async () => {
  const d = deps();
  const res = await handler(req("POST", undefined, "Bearer x"), d.deps);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null); // no fabricated ACAO
  assertEquals((await res.json()).error.code, "payments_disabled"); // its own logic, not origin_not_allowed
});
