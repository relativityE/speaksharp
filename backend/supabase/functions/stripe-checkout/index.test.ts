import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

function request(plan?: string) {
  return new Request("http://localhost/stripe-checkout", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(plan ? { plan } : {}),
  });
}

// Baseline env for the ENABLED path: payments explicitly on + a LIVE secret key. Both are required by
// the fail-closed beta guard before any checkout logic runs.
const env = (key: string) => {
  const values: Record<string, string> = {
    PAYMENTS_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    STRIPE_SECRET_KEY: "sk_live_testsecret",
    STRIPE_PRO_PRICE_ID: "price_1TbnH175Lp2WYe28RTatJout",
    SITE_URL: "https://speaksharp-public.vercel.app",
  };
  return values[key];
};

/** Build an env getter overriding the enabled baseline (e.g. to disable payments or use a test key). */
const envWith = (overrides: Record<string, string | undefined>) => (key: string) => {
  if (key in overrides) return overrides[key];
  return env(key);
};

const neverCallStripe = () => {
  let called = false;
  return {
    called: () => called,
    client: {
      checkout: { sessions: { create: async () => { called = true; return { id: "cs_unexpected", url: "x" }; } } },
    },
  };
};

const createSupabase = (stripeCustomerId: string | null = null, profileError: unknown = null) => () =>
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
              error: profileError,
            }),
        }),
      }),
    }),
  }) as any;

Deno.test("stripe-checkout edge function", async (t) => {
  await t.step("rejects paid Basic checkout as future-only", async () => {
    let stripeCalled = false;
    const res = await handler(request("basic"), {
      getEnv: env,
      createSupabase: createSupabase(),
      stripeClient: {
        checkout: {
          sessions: {
            create: async () => {
              stripeCalled = true;
              return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 400);
    assertEquals(json.error.code, "paid_basic_future");
    assertEquals(json.error.message, "Paid Basic is not available yet. Start Free or upgrade to Pro.");
    assertEquals(stripeCalled, false);
  });

  await t.step("creates Pro checkout with the configured Pro price", async () => {
    let receivedPrice: string | undefined;
    let receivedCustomerEmail: unknown;
    let receivedClientReferenceId: unknown;
    const res = await handler(request("pro"), {
      getEnv: env,
      createSupabase: createSupabase(),
      stripeClient: {
        checkout: {
          sessions: {
            create: async (params) => {
              const lineItems = params.line_items as Array<{ price?: string }>;
              receivedPrice = lineItems[0]?.price;
              receivedCustomerEmail = params.customer_email;
              receivedClientReferenceId = params.client_reference_id;
              return { id: "cs_test", url: "https://checkout.stripe.com/test" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.checkoutUrl, "https://checkout.stripe.com/test");
    assertEquals(receivedPrice, "price_1TbnH175Lp2WYe28RTatJout");
    assertEquals(receivedCustomerEmail, "user@example.com");
    assertEquals(receivedClientReferenceId, "user-123");
  });

  await t.step("reuses a stored Stripe customer instead of creating a duplicate customer", async () => {
    let receivedCustomer: unknown;
    let receivedCustomerEmail: unknown;
    const res = await handler(request("pro"), {
      getEnv: env,
      createSupabase: createSupabase("cus_existing"),
      stripeClient: {
        checkout: {
          sessions: {
            create: async (params) => {
              receivedCustomer = params.customer;
              receivedCustomerEmail = params.customer_email;
              return { id: "cs_test", url: "https://checkout.stripe.com/test" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 200);
    assertEquals(json.checkoutUrl, "https://checkout.stripe.com/test");
    assertEquals(receivedCustomer, "cus_existing");
    assertEquals(receivedCustomerEmail, undefined);
  });

  await t.step("rejects Pro checkout when the Pro price is not configured", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: (key) => key === "STRIPE_PRO_PRICE_ID" ? undefined : env(key),
      createSupabase: createSupabase(),
      stripeClient: {
        checkout: {
          sessions: {
            create: async () => {
              stripeCalled = true;
              return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "CONFIG_MISSING_ENV");
    assertEquals(json.error.message, "Configuration Error: STRIPE_PRO_PRICE_ID is missing");
    assertEquals(json.error.details.missing, "STRIPE_PRO_PRICE_ID");
    assertEquals(stripeCalled, false);
  });

  await t.step("fails safely instead of creating checkout when billing profile lookup fails", async () => {
    let stripeCalled = false;
    const res = await handler(request("pro"), {
      getEnv: env,
      createSupabase: createSupabase(null, { message: "profile unavailable" }),
      stripeClient: {
        checkout: {
          sessions: {
            create: async () => {
              stripeCalled = true;
              return { id: "cs_unexpected", url: "https://checkout.stripe.com/unexpected" };
            },
          },
        },
      },
    });
    const json = await res.json();

    assertEquals(res.status, 500);
    assertEquals(json.error.code, "DATABASE_ERROR");
    assertEquals(stripeCalled, false);
  });

  await t.step("fails closed with 403 when payments are not explicitly enabled (no checkout created)", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ PAYMENTS_ENABLED: undefined }),
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(json.error.message, "Pro enrollment is not open during this beta.");
    assertEquals(stripe.called(), false);
  });

  await t.step("fails closed with 403 when the Stripe secret key is not a live key", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ STRIPE_SECRET_KEY: "sk_test_notlive" }),
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(stripe.called(), false);
  });

  await t.step("fails closed with 403 when payments enabled but no secret key present", async () => {
    const stripe = neverCallStripe();
    const res = await handler(request("pro"), {
      getEnv: envWith({ STRIPE_SECRET_KEY: undefined }),
      createSupabase: createSupabase(),
      stripeClient: stripe.client,
    });
    const json = await res.json();
    assertEquals(res.status, 403);
    assertEquals(json.error.code, "payments_disabled");
    assertEquals(stripe.called(), false);
  });
});
