import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

function request(method = "POST") {
  return new Request("http://localhost/stripe-billing-portal", {
    method,
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
  });
}

const env = (key: string) => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    STRIPE_SECRET_KEY: "stripe-secret",
    SITE_URL: "https://speaksharp-public.vercel.app",
  };
  return values[key];
};

const createSupabase = (stripeCustomerId: string | null) => () =>
  ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "user-123", email: "user@example.com" } },
          error: null,
        }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : { stripe_customer_id: null },
              error: null,
            }),
        }),
      }),
    }),
  }) as any;

Deno.test("stripe-billing-portal edge function", async (t) => {
  await t.step("creates a billing portal session for an existing Stripe customer", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const res = await handler(request(), {
      getEnv: env,
      createSupabase: createSupabase("cus_123"),
      stripeClient: {
        billingPortal: {
          sessions: {
            create: async (params) => {
              capturedParams = params;
              return { url: "https://billing.stripe.com/session/test" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.portalUrl, "https://billing.stripe.com/session/test");
    assertEquals(capturedParams?.customer, "cus_123");
    assertEquals(capturedParams?.return_url, "https://speaksharp-public.vercel.app/pricing?billing=returned");
  });

  await t.step("fails safely when the profile has no Stripe customer id", async () => {
    let stripeCalled = false;
    const res = await handler(request(), {
      getEnv: env,
      createSupabase: createSupabase(null),
      stripeClient: {
        billingPortal: {
          sessions: {
            create: async () => {
              stripeCalled = true;
              return { url: "https://billing.stripe.com/unexpected" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.error.code, "VALIDATION_MISSING_FIELD");
    assertEquals(json.error.details.missing, "stripe_customer_id");
    assertEquals(stripeCalled, false);
  });
});
