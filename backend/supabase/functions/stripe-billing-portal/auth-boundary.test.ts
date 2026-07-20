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
  return new Request("https://fn/stripe-billing-portal", {
    method: "POST",
    headers,
  });
}

function deps(authError: { message: string } | null) {
  const calls = { portalCreate: 0 };
  const env: Record<string, string> = {
    SITE_URL: "https://site.example",
    STRIPE_SECRET_KEY: "sk_live_test",
  };
  const getEnv = (k: string) => env[k];
  // deno-lint-ignore no-explicit-any
  const stripeClient = {
    billingPortal: {
      sessions: {
        create: () => {
          calls.portalCreate++;
          return Promise.resolve({ url: "https://stripe/portal" });
        },
      },
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
          single: () =>
            Promise.resolve({
              data: { stripe_customer_id: "cus_x" },
              error: null,
            }),
        }),
      }),
    }),
  })) as any;
  return { calls, deps: { getEnv, stripeClient, createSupabase } };
}

Deno.test("stripe-billing-portal: forged token → auth failure BEFORE portal session", async () => {
  const d = deps({ message: "invalid JWT" });
  const res = await handler(req(forgedBearer()), d.deps);
  assert(
    res.status >= 400 && res.status < 500,
    `expected 4xx, got ${res.status}`,
  );
  assertEquals((await res.json()).error.code, "AUTH_INVALID_TOKEN");
  assertEquals(d.calls.portalCreate, 0); // no Stripe billing-portal session created
});

Deno.test("stripe-billing-portal: missing token → 401 BEFORE portal session", async () => {
  const d = deps(null);
  const res = await handler(req(), d.deps);
  assertEquals(res.status, 401);
  assertEquals(d.calls.portalCreate, 0);
});
