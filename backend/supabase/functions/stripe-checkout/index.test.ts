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

const env = (key: string) => {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    STRIPE_SECRET_KEY: "stripe-secret",
    STRIPE_PRO_PRICE_ID: "price_1TbnH175Lp2WYe28RTatJout",
    SITE_URL: "https://speaksharp-public.vercel.app",
  };
  return values[key];
};

const createSupabase = () =>
  ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "user-123", email: "user@example.com" } },
          error: null,
        }),
    },
  }) as any;

Deno.test("stripe-checkout edge function", async (t) => {
  await t.step("rejects paid Basic checkout as future-only", async () => {
    let stripeCalled = false;
    const res = await handler(request("basic"), {
      getEnv: env,
      createSupabase,
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
    const res = await handler(request("pro"), {
      getEnv: env,
      createSupabase,
      stripeClient: {
        checkout: {
          sessions: {
            create: async (params) => {
              const lineItems = params.line_items as Array<{ price?: string }>;
              receivedPrice = lineItems[0]?.price;
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
  });
});
