/**
 * #1282 blocker 5 — stripe-webhook ADVERSARIAL properties for the canonical-snapshot flow. Entitlement is
 * decided by the CURRENT Stripe subscription the handler hydrates, never by event action or arrival order,
 * so the adversarial concerns are: (a) idempotency — a duplicate event applies once and returns 200; and
 * (b) the DB snapshot RPC OWNS idempotency + rollback, so when it reports failure the handler returns a
 * non-2xx (Stripe retries) and never reports success. The removed action-based contract (upgrade_to_pro/
 * activate_basic) is intentionally NOT tested — that path no longer exists.
 */
import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const env = (key: string) => {
    const v: Record<string, string> = { STRIPE_PRO_PRICE_ID: "price_pro_1282", STRIPE_PRICE_CURRENCY: "usd" };
    return v[key];
};

const validPrice = { id: "price_pro_1282", active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
const activeSub = { id: "sub_123", status: "active", customer: "cus_123", cancel_at_period_end: false, current_period_end: 3000, items: { data: [{ price: validPrice }] } };

const stripe = {
    webhooks: { constructEvent: (body: string) => JSON.parse(body) },
    subscriptions: { retrieve: (_id: string) => Promise.resolve(activeSub) },
    prices: { retrieve: (_id: string) => Promise.resolve(validPrice) },
};

// The snapshot RPC owns idempotency + atomic rollback; the handler only forwards the current status.
const setupSupabase = (options: { skipped?: boolean; success?: boolean } = {}) => {
    let rpcCalledCount = 0;
    const supabase = {
        rpc: (_fn: string, _args: Record<string, unknown>) => {
            rpcCalledCount++;
            if (options.success === false) {
                return Promise.resolve({ data: { success: false, error: 'DB Down' }, error: null });
            }
            return Promise.resolve({ data: { success: true, skipped: Boolean(options.skipped), entitlement: 'pro' }, error: null });
        },
    } as any;
    return { supabase, getRpcCount: () => rpcCalledCount };
};

const mkReq = () => new Request('http://localhost', {
    method: 'POST',
    headers: { 'Stripe-Signature': 'fake' },
    body: JSON.stringify({ id: 'evt_test_123', type: 'customer.subscription.updated', created: 1000, data: { object: { id: 'sub_123' } } }),
});

Deno.test("stripe-webhook snapshot adversarial tests", async (t) => {
    await t.step("a duplicate event is applied once and returns 200 (idempotency owned by the RPC)", async () => {
        const { supabase, getRpcCount } = setupSupabase({ skipped: true });
        const res = await handler(mkReq(), stripe, supabase, 'secret', env);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.skipped, true);
        assertEquals(getRpcCount(), 1, "Snapshot RPC should be called exactly once and decide skip");
    });

    await t.step("a new event applies the CURRENT status snapshot and returns 200", async () => {
        const { supabase, getRpcCount } = setupSupabase();
        const res = await handler(mkReq(), stripe, supabase, 'secret', env);
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.received, true);
        assertEquals(getRpcCount(), 1);
    });

    await t.step("when the snapshot RPC reports failure the handler returns non-2xx (Stripe retries)", async () => {
        const { supabase, getRpcCount } = setupSupabase({ success: false });
        const res = await handler(mkReq(), stripe, supabase, 'secret', env);

        assertEquals(res.status, 500);
        assertEquals(getRpcCount(), 1, "Snapshot RPC owns idempotency and atomic rollback");
    });
});
