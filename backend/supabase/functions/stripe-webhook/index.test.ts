/**
 * #1282 blocker 5 — stripe-webhook: verify signature → HYDRATE the current Stripe subscription → VALIDATE
 * the configured $10 monthly price for granting states → apply the canonical snapshot. Entitlement is
 * decided by the current subscription state, never by event action/order. Retrieval/identity/price/DB
 * uncertainty returns non-2xx so Stripe retries. checkout.session.completed alone does not grant.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const env = (key: string) => {
  const v: Record<string, string> = { STRIPE_PRO_PRICE_ID: "price_pro_1282", STRIPE_PRICE_CURRENCY: "usd" };
  return v[key];
};

const validPrice = { id: "price_pro_1282", active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
// A subscription object as Stripe.subscriptions.retrieve returns it (price expanded on the item).
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, current_period_end: 3000,
  items: { data: [{ price: validPrice }] }, ...over,
});

const mkStripe = (opts: { retrieveSub?: any; retrieveErr?: boolean; priceRetrieve?: any; priceErr?: boolean } = {}) => ({
  webhooks: { constructEvent: (body: string) => JSON.parse(body) },
  subscriptions: {
    retrieve: (_id: string) => opts.retrieveErr ? Promise.reject(new Error("stripe down")) : Promise.resolve(opts.retrieveSub ?? sub()),
  },
  prices: {
    retrieve: (_id: string) => opts.priceErr ? Promise.reject(new Error("price down")) : Promise.resolve(opts.priceRetrieve ?? validPrice),
  },
});

const mkSupabase = (rpcResult: any = { data: { success: true, entitlement: "pro" }, error: null }) => {
  let capturedArgs: any = null;
  return {
    calls: () => capturedArgs,
    supabase: { rpc: (_fn: string, args: any) => { capturedArgs = args; return Promise.resolve(rpcResult); } },
  };
};

const req = (event: any) => new Request("http://localhost", { method: "POST", headers: { "Stripe-Signature": "mock" }, body: JSON.stringify(event) });

Deno.test("stripe-webhook — canonical snapshot flow", async (t) => {
  await t.step("checkout.session.completed with an active, correctly-priced sub → snapshot with user binding", async () => {
    const sb = mkSupabase();
    const res = await handler(req({ id: "e1", type: "checkout.session.completed", created: 1000,
      data: { object: { metadata: { userId: "user_1" }, subscription: "sub_1", customer: "cus_1" } } }),
      mkStripe(), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls().p_status, "active");
    assertEquals(sb.calls().p_user_id, "user_1");        // first binding uses checkout metadata
    assertEquals(sb.calls().p_subscription_id, "sub_1");
    assertEquals(sb.calls().p_event_created, 1000);
  });

  await t.step("checkout.session.completed WITHOUT userId metadata → 400 (no grant)", async () => {
    const res = await handler(req({ id: "e2", type: "checkout.session.completed", data: { object: { metadata: {}, subscription: "sub_1" } } }),
      mkStripe(), mkSupabase().supabase, "secret", env);
    assertEquals(res.status, 400);
  });

  await t.step("subscription.updated active + valid price → snapshot 'active' (no user binding on later events)", async () => {
    const sb = mkSupabase();
    const res = await handler(req({ id: "e3", type: "customer.subscription.updated", created: 2000, data: { object: { id: "sub_1" } } }),
      mkStripe(), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls().p_status, "active");
    assertEquals(sb.calls().p_user_id, null);           // later events use stored identity
  });

  await t.step("active sub with the WRONG price → non-2xx, NO snapshot (cannot grant)", async () => {
    const sb = mkSupabase();
    const wrong = sub({ items: { data: [{ price: { id: "price_other", active: true, unit_amount: 500, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] } });
    const res = await handler(req({ id: "e4", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: wrong }), sb.supabase, "secret", env);
    assertEquals(res.status, 500);
    assertEquals(sb.calls(), null);                     // snapshot never called
  });

  await t.step("active sub with a 3-month interval_count → non-2xx (not monthly)", async () => {
    const bad = sub({ items: { data: [{ price: { ...validPrice, recurring: { interval: "month", interval_count: 3 } } }] } });
    const res = await handler(req({ id: "e4b", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: bad }), mkSupabase().supabase, "secret", env);
    assertEquals(res.status, 500);
  });

  await t.step("past_due → snapshot 'past_due' (NO price check; does not grant)", async () => {
    const sb = mkSupabase({ data: { success: true, entitlement: "free" }, error: null });
    const res = await handler(req({ id: "e5", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: sub({ status: "past_due" }) }), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls().p_status, "past_due");
  });

  await t.step("deleted/canceled → snapshot 'canceled' (terminal; no price check)", async () => {
    const sb = mkSupabase({ data: { success: true, entitlement: "free" }, error: null });
    const res = await handler(req({ id: "e6", type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: sub({ status: "canceled" }) }), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls().p_status, "canceled");
  });

  await t.step("subscription retrieval failure → 502 (retryable, no snapshot)", async () => {
    const sb = mkSupabase();
    const res = await handler(req({ id: "e7", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveErr: true }), sb.supabase, "secret", env);
    assertEquals(res.status, 502);
    assertEquals(sb.calls(), null);
  });

  await t.step("price identity UNCERTAIN (unexpanded price + retrieve fails) → 502 (retryable)", async () => {
    const sb = mkSupabase();
    const unexpanded = sub({ items: { data: [{ price: "price_pro_1282" }] } }); // just an id, not expanded
    const res = await handler(req({ id: "e8", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: unexpanded, priceErr: true }), sb.supabase, "secret", env);
    assertEquals(res.status, 502);
    assertEquals(sb.calls(), null);
  });

  await t.step("DB snapshot failure → 500 (retryable)", async () => {
    const res = await handler(req({ id: "e9", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe(), mkSupabase({ data: { success: false, error: "boom" }, error: null }).supabase, "secret", env);
    assertEquals(res.status, 500);
  });

  await t.step("duplicate delivery (snapshot skipped) → 200 idempotent", async () => {
    const res = await handler(req({ id: "e10", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe(), mkSupabase({ data: { success: true, skipped: true }, error: null }).supabase, "secret", env);
    assertEquals(res.status, 200);
  });

  await t.step("a non-subscription event is acknowledged and ignored (200)", async () => {
    const sb = mkSupabase();
    const res = await handler(req({ id: "e11", type: "customer.updated", data: { object: { id: "cus_1" } } }),
      mkStripe(), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls(), null); // no snapshot for a non-subscription event
  });

  await t.step("cancel_at_period_end on an active sub keeps access (status active forwarded)", async () => {
    const sb = mkSupabase();
    const res = await handler(req({ id: "e12", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } }),
      mkStripe({ retrieveSub: sub({ cancel_at_period_end: true }) }), sb.supabase, "secret", env);
    assertEquals(res.status, 200);
    assertEquals(sb.calls().p_status, "active");
    assertEquals(sb.calls().p_cancel_at_period_end, true);
  });
});
