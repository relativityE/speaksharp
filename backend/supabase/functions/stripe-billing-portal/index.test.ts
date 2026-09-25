import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

function request(method = "POST", body?: string) {
  return new Request("http://localhost/stripe-billing-portal", {
    method,
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body,
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

const createSupabase = (stripeCustomerId: string | null, stripeSubscriptionId: string | null = "sub_123") => () =>
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
              data: { stripe_customer_id: stripeCustomerId, stripe_subscription_id: stripeSubscriptionId },
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
    assertEquals(capturedParams?.return_url, "https://speaksharp-public.vercel.app/account?billing=returned");
    assertEquals(capturedParams?.flow_data, undefined);
  });

  await t.step("a paid owner enters Stripe's cancellation flow for their own subscription", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const res = await handler(request("POST", JSON.stringify({ flow: "cancel" })), {
      getEnv: env, createSupabase: createSupabase("cus_123"),
      stripeClient: { billingPortal: { sessions: { create: async (params) => {
        capturedParams = params; return { url: "https://billing.stripe.com/session/cancel" };
      } } } },
    });
    assertEquals(res.status, 200);
    assertEquals(capturedParams?.flow_data, {
      type: "subscription_cancel",
      subscription_cancel: { subscription: "sub_123" },
      after_completion: { type: "redirect", redirect: {
        return_url: "https://speaksharp-public.vercel.app/account?billing=returned",
      } },
    });
  });

  await t.step("no subscription cannot open a cancellation flow", async () => {
    let stripeCalled = false;
    const res = await handler(request("POST", JSON.stringify({ flow: "cancel" })), {
      getEnv: env, createSupabase: createSupabase("cus_123", null),
      stripeClient: { billingPortal: { sessions: { create: async () => {
        stripeCalled = true; return { url: "https://billing.stripe.com/unexpected" };
      } } } },
    });
    assertEquals(res.status, 400);
    assertEquals(stripeCalled, false);
  });

  await t.step("unknown portal requests fail before opening Stripe", async () => {
    let stripeCalled = false;
    const res = await handler(request("POST", JSON.stringify({ flow: "unknown" })), {
      getEnv: env, createSupabase: createSupabase("cus_123"),
      stripeClient: { billingPortal: { sessions: { create: async () => {
        stripeCalled = true; return { url: "https://billing.stripe.com/unexpected" };
      } } } },
    });
    assertEquals(res.status, 400);
    assertEquals(stripeCalled, false);
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
