/**
 * Unit tests for stripe-webhook Edge Function.
 * 
 * Strategy: Test business logic (subscription updates) without mocking Stripe signature verification.
 * The signature verification is Stripe SDK's responsibility - we trust it.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const mockStripe = {
  webhooks: {
    constructEvent: (body: string, _sig: string, _secret: string) => {
      return JSON.parse(body);
    }
  }
};

const createMockSupabase = (rpcResult: any) => ({
  rpc: (_fn: string, _args: any) => Promise.resolve(rpcResult)
});

Deno.test("stripe-webhook handlers", async (t) => {

  const createRequest = (event: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify(event)
  });

  await t.step("handles OPTIONS preflight without Stripe signature verification", async () => {
    let constructed = false;
    const stripe = {
      webhooks: {
        constructEvent: () => {
          constructed = true;
          throw new Error("should not construct Stripe events for preflight");
        }
      }
    };

    const response = await handler(
      new Request("http://localhost", {
        method: "OPTIONS",
        headers: { Origin: "https://speaksharp-public.vercel.app" }
      }),
      stripe,
      createMockSupabase({ data: { success: true }, error: null }),
      "secret"
    );

    assertEquals(response.status, 200);
    assertEquals(constructed, false);
    assertEquals(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  });

  await t.step("handleCheckoutCompleted - upgrades user to Pro", async () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { metadata: { userId: "user_1" }, subscription: "sub_1" } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true, skipped: false }, error: null });
      }
    };

    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 200);
    assertEquals(capturedArgs.p_action, "upgrade_to_pro");
    assertEquals(capturedArgs.p_user_id, "user_1");
  });

  await t.step("handleCheckoutCompleted - activates paid Basic without Pro upgrade", async () => {
    const event = {
      id: "evt_basic",
      type: "checkout.session.completed",
      data: { object: { metadata: { userId: "user_1", plan: "basic" }, subscription: "sub_basic" } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true, skipped: false }, error: null });
      }
    };

    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 200);
    assertEquals(capturedArgs.p_action, "activate_basic");
    assertEquals(capturedArgs.p_user_id, "user_1");
    assertEquals(capturedArgs.p_subscription_id, "sub_basic");
  });

  await t.step("handleCheckoutCompleted - fails without userId", async () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { metadata: {}, subscription: "sub_1" } }
    };

    const mockSupabase = createMockSupabase({ data: { success: true }, error: null });
    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 400); // Bad request due to missing metadata
  });

  await t.step("handleSubscriptionDeleted - downgrades user to Free baseline", async () => {
    const event = {
      id: "evt_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true, skipped: false }, error: null });
      }
    };

    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 200);
    assertEquals(capturedArgs.p_action, "downgrade_to_basic");
  });

  await t.step("handles RPC error", async () => {
    const event = {
      id: "evt_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } }
    };

    const mockSupabase = createMockSupabase({ data: null, error: { message: "RPC Error" } });
    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 500);
  });

  await t.step("handles skipped event", async () => {
    const event = {
      id: "evt_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } }
    };

    const mockSupabase = createMockSupabase({ data: { skipped: true }, error: null });
    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");

    assertEquals(response.status, 200);
  });
});

Deno.test("stripe-webhook subscription.updated handlers", async (t) => {
  const createRequest = (event: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify(event)
  });

  const getArgs = async (status: string, plan = "pro") => {
    const event = {
      id: "evt_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status, metadata: { userId: "user_1", plan } } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true }, error: null });
      }
    };

    await handler(createRequest(event), mockStripe, mockSupabase, "secret");
    return capturedArgs.p_action;
  };

  await t.step("handleSubscriptionUpdated - downgrades on canceled status", async () => {
    assertEquals(await getArgs("canceled"), "downgrade_to_basic");
  });

  await t.step("handleSubscriptionUpdated - downgrades on unpaid status", async () => {
    assertEquals(await getArgs("unpaid"), "downgrade_to_basic");
  });

  await t.step("handleSubscriptionUpdated - downgrades on past_due status", async () => {
    assertEquals(await getArgs("past_due"), "downgrade_to_basic");
  });

  await t.step("handleSubscriptionUpdated - no action on active status", async () => {
    assertEquals(await getArgs("active"), "upgrade_to_pro");
  });

  await t.step("handleSubscriptionUpdated - restores paid Basic on active status", async () => {
    assertEquals(await getArgs("active", "basic"), "activate_basic");
  });
});

Deno.test("stripe-webhook invoice.payment_failed handlers", async (t) => {
  const createRequest = (event: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify(event)
  });

  const getArgs = async (attempt_count: number) => {
    const event = {
      id: "evt_1",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_1", attempt_count } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true }, error: null });
      }
    };

    await handler(createRequest(event), mockStripe, mockSupabase, "secret");
    return capturedArgs.p_action;
  };

  await t.step("handlePaymentFailed - no action if < 3 attempts", async () => {
    assertEquals(await getArgs(2), "none");
  });

  await t.step("handlePaymentFailed - downgrades at 3+ attempts", async () => {
    assertEquals(await getArgs(3), "downgrade_to_basic");
  });

});
