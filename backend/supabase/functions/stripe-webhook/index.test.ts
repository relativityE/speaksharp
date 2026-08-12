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

    assertEquals(response.status, 204); // approved-origin preflight → 204 (exact-origin CORS)
    assertEquals(constructed, false);
    assertEquals(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://speaksharp-public.vercel.app");
  });

  await t.step("handleCheckoutCompleted - upgrades user to Pro", async () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { metadata: { userId: "user_1" }, subscription: "sub_1", customer: "cus_1" } }
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
    assertEquals(capturedArgs.p_subscription_id, "sub_1");
    assertEquals(capturedArgs.p_stripe_customer_id, "cus_1");
  });

  await t.step("handleCheckoutCompleted - activates paid Basic without Pro upgrade", async () => {
    const event = {
      id: "evt_basic",
      type: "checkout.session.completed",
      data: { object: { metadata: { userId: "user_1", plan: "basic" }, subscription: "sub_basic", customer: "cus_basic" } }
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
    assertEquals(capturedArgs.p_stripe_customer_id, "cus_basic");
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
    assertEquals(capturedArgs.p_action, "downgrade_to_free");
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
      data: { object: { id: "sub_1", status, customer: "cus_1", metadata: { userId: "user_1", plan } } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true }, error: null });
      }
    };

    await handler(createRequest(event), mockStripe, mockSupabase, "secret");
    return capturedArgs;
  };

  await t.step("handleSubscriptionUpdated - terminal cancel clears entitlement (downgrade_to_free)", async () => {
    const args = await getArgs("canceled");
    assertEquals(args.p_action, "downgrade_to_free");
    assertEquals(args.p_stripe_customer_id, "cus_1");
  });

  await t.step("handleSubscriptionUpdated - unpaid is a recoverable lapse (keeps sub id)", async () => {
    // #1282 finding-1 fix: a recoverable lapse must NOT clear the subscription id, so renew_pro can
    // restore Pro after recovery. unpaid/past_due route to lapse_pro, not downgrade_to_free.
    assertEquals((await getArgs("unpaid")).p_action, "lapse_pro");
  });

  await t.step("handleSubscriptionUpdated - past_due is a recoverable lapse (keeps sub id)", async () => {
    assertEquals((await getArgs("past_due")).p_action, "lapse_pro");
  });

  await t.step("handleSubscriptionUpdated - no action on active status", async () => {
    assertEquals((await getArgs("active")).p_action, "upgrade_to_pro");
  });

  await t.step("handleSubscriptionUpdated - restores paid Basic on active status", async () => {
    assertEquals((await getArgs("active", "basic")).p_action, "activate_basic");
  });

  await t.step("handleSubscriptionUpdated - signed no-op (active, no userId) acks 200 without mutation", async () => {
    // Mirrors the live signed-webhook readiness no-op: a valid, signed subscription
    // event that resolves to no actionable user must be acknowledged (200 received),
    // not surfaced as a DB failure, and must not mutate entitlement (p_action 'none').
    const event = {
      id: "evt_noop_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_noop_1", status: "active" } }
    };

    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true, skipped: false }, error: null });
      }
    };

    const response = await handler(createRequest(event), mockStripe, mockSupabase, "secret");
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.received, true);
    assertEquals(capturedArgs.p_action, "none");
    assertEquals(capturedArgs.p_user_id, null);
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

  await t.step("handlePaymentFailed - recoverable lapse at 3+ attempts (keeps sub id for recovery)", async () => {
    assertEquals(await getArgs(3), "lapse_pro");
  });

});

Deno.test("stripe-webhook renewal + event ordering (#1282)", async (t) => {
  const createRequest = (event: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify(event)
  });

  const capture = async (event: any) => {
    let capturedArgs: any;
    const mockSupabase = {
      rpc: (_fn: string, args: any) => {
        capturedArgs = args;
        return Promise.resolve({ data: { success: true, skipped: false }, error: null });
      }
    };
    const res = await handler(createRequest(event), mockStripe, mockSupabase, "secret");
    return { capturedArgs, status: res.status };
  };

  await t.step("invoice.payment_succeeded (subscription_cycle) renews Pro, keyed on subscription", async () => {
    const { capturedArgs, status } = await capture({
      id: "evt_renew_1",
      type: "invoice.payment_succeeded",
      created: 1_700_000_500,
      data: { object: { subscription: "sub_1", customer: "cus_1", billing_reason: "subscription_cycle" } }
    });
    assertEquals(status, 200);
    assertEquals(capturedArgs.p_action, "renew_pro");
    assertEquals(capturedArgs.p_subscription_id, "sub_1");
    assertEquals(capturedArgs.p_stripe_customer_id, "cus_1");
    assertEquals(capturedArgs.p_event_created, 1_700_000_500);
  });

  await t.step("invoice.payment_succeeded for the initial subscription invoice is a no-op (checkout handles it)", async () => {
    const { capturedArgs } = await capture({
      id: "evt_first_invoice",
      type: "invoice.payment_succeeded",
      created: 1_700_000_000,
      data: { object: { subscription: "sub_1", customer: "cus_1", billing_reason: "subscription_create" } }
    });
    assertEquals(capturedArgs.p_action, "none");
  });

  await t.step("every event forwards its Stripe created time for the out-of-order guard", async () => {
    const { capturedArgs } = await capture({
      id: "evt_del_late",
      type: "customer.subscription.deleted",
      created: 1_700_000_900,
      data: { object: { id: "sub_1" } }
    });
    assertEquals(capturedArgs.p_action, "downgrade_to_free");
    assertEquals(capturedArgs.p_event_created, 1_700_000_900);
  });

  await t.step("a missing created time forwards null (guard falls back to append-only)", async () => {
    const { capturedArgs } = await capture({
      id: "evt_no_created",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1" } }
    });
    assertEquals(capturedArgs.p_event_created, null);
  });
});

Deno.test("stripe-webhook backward-compat fallback (#1282 pre-migration safety)", async (t) => {
  const req = (event: any) => new Request("http://localhost", {
    method: "POST",
    headers: { "Stripe-Signature": "mock" },
    body: JSON.stringify(event),
  });

  // A stateful supabase mock: returns queued responses in order and records every rpc call's args.
  const compatMock = (responses: Array<{ data?: any; error?: any }>) => {
    const calls: any[] = [];
    let i = 0;
    return {
      calls: () => calls,
      supabase: {
        rpc: (_fn: string, args: any) => {
          calls.push(args);
          const r = responses[Math.min(i, responses.length - 1)];
          i += 1;
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
        },
      },
    };
  };

  await t.step("new DB: primary (7-arg) call succeeds — no fallback, forwards p_event_created", async () => {
    const m = compatMock([{ data: { success: true, skipped: false } }]);
    const res = await handler(req({ id: "e1", type: "invoice.payment_failed", created: 1000,
      data: { object: { subscription: "sub_1", attempt_count: 3 } } }), mockStripe, m.supabase, "secret");
    assertEquals(res.status, 200);
    assertEquals(m.calls().length, 1);
    assertEquals(m.calls()[0].p_action, "lapse_pro");
    assertEquals(m.calls()[0].p_event_created, 1000);
  });

  await t.step("pre-#1282 DB (PGRST202): falls back to 6-arg with legacy action (lapse_pro -> downgrade_to_free)", async () => {
    const m = compatMock([
      { error: { code: "PGRST202", message: "Could not find the function public.process_stripe_webhook_event(..., p_event_created)" } },
      { data: { success: true, skipped: false } },
    ]);
    const res = await handler(req({ id: "e2", type: "invoice.payment_failed", created: 2000,
      data: { object: { subscription: "sub_1", attempt_count: 3 } } }), mockStripe, m.supabase, "secret");
    assertEquals(res.status, 200);
    assertEquals(m.calls().length, 2);
    // Primary tried the FULL new contract...
    assertEquals(m.calls()[0].p_action, "lapse_pro");
    assertEquals(m.calls()[0].p_event_created, 2000);
    // ...fallback used the pre-#1282 contract: mapped action + NO p_event_created key.
    assertEquals(m.calls()[1].p_action, "downgrade_to_free");
    assertEquals("p_event_created" in m.calls()[1], false);
  });

  await t.step("pre-#1282 DB ('Unknown action'): renew_pro maps to a safe no-op", async () => {
    const m = compatMock([
      { error: { message: "Unknown action: renew_pro" } },
      { data: { success: true } },
    ]);
    await handler(req({ id: "e3", type: "invoice.payment_succeeded", created: 3000,
      data: { object: { subscription: "sub_1", billing_reason: "subscription_cycle" } } }), mockStripe, m.supabase, "secret");
    assertEquals(m.calls()[0].p_action, "renew_pro");
    assertEquals(m.calls()[1].p_action, "none");
  });

  await t.step("a GENUINE db error is NOT masked by the fallback (500, single call)", async () => {
    const m = compatMock([{ error: { code: "P0001", message: "some real failure" } }]);
    const res = await handler(req({ id: "e4", type: "customer.subscription.deleted", created: 4000,
      data: { object: { id: "sub_1" } } }), mockStripe, m.supabase, "secret");
    assertEquals(res.status, 500);
    assertEquals(m.calls().length, 1);
  });
});
