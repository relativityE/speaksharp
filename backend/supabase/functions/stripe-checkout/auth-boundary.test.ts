import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const APPROVED = "https://speaksharp-public.vercel.app";

function forgedBearer() {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=+$/,
      "",
    );
  return `Bearer ${b64({ alg: "HS256", typ: "JWT" })}.${
    b64({ sub: "forged", role: "authenticated" })
  }.forged_sig`;
}

function req(auth?: string) {
  const headers = new Headers({ Origin: APPROVED });
  if (auth) headers.set("Authorization", auth);
  return new Request("https://fn/stripe-checkout", { method: "POST", headers });
}

// Payments ENABLED for these tests (controlled) — so we exercise the auth boundary, not the
// fail-closed billing guard. A missing/forged token must be rejected BEFORE a Stripe checkout
// session is created.
function deps(authError: { message: string } | null) {
  const calls = { sessionCreate: 0 };
  const env: Record<string, string> = {
    PAYMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_test",
    SITE_URL: "https://site.example",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    STRIPE_PRO_PRICE_ID: "price_pro",
  };
  const getEnv = (k: string) => env[k];
  // deno-lint-ignore no-explicit-any
  const stripeClient = {
    checkout: {
      sessions: {
        create: () => {
          calls.sessionCreate++;
          return Promise.resolve({ url: "https://stripe/session" });
        },
      },
    },
    customers: {
      list: () => Promise.resolve({ data: [] }),
      create: () => Promise.resolve({ id: "cus_x" }),
    },
  } as any;
  // deno-lint-ignore no-explicit-any
  const createSupabase = ((_auth: string | null) => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: authError ? null : { id: "u1" } },
          error: authError,
        }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  })) as any;
  return { calls, deps: { getEnv, stripeClient, createSupabase } };
}

Deno.test("stripe-checkout: payments enabled + forged token → auth failure BEFORE Stripe session", async () => {
  const d = deps({ message: "invalid JWT" });
  const res = await handler(req(forgedBearer()), d.deps);
  assert(
    res.status >= 400 && res.status < 500,
    `expected 4xx, got ${res.status}`,
  );
  assertEquals((await res.json()).error.code, "AUTH_INVALID_TOKEN");
  assertEquals(d.calls.sessionCreate, 0); // no Stripe checkout session created
});

Deno.test("stripe-checkout: payments enabled + missing token → 401 BEFORE Stripe session", async () => {
  const d = deps(null);
  const res = await handler(req(), d.deps);
  assertEquals(res.status, 401);
  assertEquals(d.calls.sessionCreate, 0);
});
