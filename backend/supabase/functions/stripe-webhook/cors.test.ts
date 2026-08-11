import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";
const HOSTILE = "https://evil-example.com";

// Stripe → server webhooks carry NO Origin. A browser hitting the webhook with a hostile Origin
// must be rejected BEFORE signature verification / DB writes.
function stripeSpy() {
  const calls = { construct: 0, rpc: 0 };
  const stripe = {
    webhooks: {
      constructEvent: (body: string) => {
        calls.construct++;
        return JSON.parse(body);
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  // deno-lint-ignore no-explicit-any
  const supabase = {
    rpc: () => {
      calls.rpc++;
      return Promise.resolve({ data: { success: true }, error: null });
    },
  } as any;
  return { calls, stripe, supabase };
}

function req(method: string, origin?: string, body?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (body !== undefined) headers.set("Stripe-Signature", "mock");
  return new Request("https://fn/stripe-webhook", { method, headers, body });
}

Deno.test("stripe-webhook CORS: no-Origin (Stripe) request is permitted, reaches signature/logic", async () => {
  const s = stripeSpy();
  const event = {
    id: "evt_1",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1" } },
  };
  const res = await handler(
    req("POST", undefined, JSON.stringify(event)),
    s.stripe,
    s.supabase,
    "secret",
  );
  // Not a CORS 403 — proceeds to its own handling (constructs the event).
  assert(res.status !== 403);
  assertEquals(s.calls.construct, 1);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null); // no fabricated ACAO
});

Deno.test("stripe-webhook CORS: hostile browser Origin → 403 BEFORE signature verification / DB", async () => {
  const s = stripeSpy();
  const event = {
    id: "evt_2",
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_2" } },
  };
  const res = await handler(
    req("POST", HOSTILE, JSON.stringify(event)),
    s.stripe,
    s.supabase,
    "secret",
  );
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await res.json()).error.code, "origin_not_allowed");
  assertEquals(s.calls.construct, 0); // signature verification never ran
  assertEquals(s.calls.rpc, 0); // no DB write
});

Deno.test("stripe-webhook CORS: hostile OPTIONS → 403; approved OPTIONS → 204 + exact ACAO", async () => {
  const s = stripeSpy();
  const hostile = await handler(
    req("OPTIONS", HOSTILE),
    s.stripe,
    s.supabase,
    "secret",
  );
  assertEquals(hostile.status, 403);
  assertEquals(hostile.headers.get("Access-Control-Allow-Origin"), null);

  const ok = await handler(
    req("OPTIONS", APPROVED),
    s.stripe,
    s.supabase,
    "secret",
  );
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), APPROVED);
  assertEquals(s.calls.construct, 0);
});
