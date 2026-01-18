import { handler } from './index.ts';
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("stripe-webhook idempotency adversarial tests", async (t) => {

    const mockEvent = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: {
            object: {
                metadata: { userId: 'user_123' },
                subscription: 'sub_123'
            }
        }
    };

    const setupMocks = (options: { insertStatus?: number, updateStatus?: number, existing?: boolean } = {}) => {
        let upgradeCalledCount = 0;
        let insertCalledCount = 0;
        let deleteCalledCount = 0;

        const stripe = {
            webhooks: {
                constructEvent: () => Promise.resolve(mockEvent)
            }
        };

        const supabase = {
            from: (_table: string) => ({
                insert: () => {
                    insertCalledCount++;
                    if (options.existing) return Promise.resolve({ error: { code: '23505' } });
                    return Promise.resolve({ error: null });
                },
                select: () => ({
                    eq: () => ({
                        single: () => Promise.resolve({ data: options.existing ? { id: 1 } : null, error: options.existing ? null : { code: 'PGRST116' } })
                    })
                }),
                update: () => ({
                    eq: () => {
                        upgradeCalledCount++;
                        if (options.updateStatus === 500) return Promise.resolve({ error: { message: 'DB Down' } });
                        return Promise.resolve({ error: null });
                    }
                }),
                delete: () => ({
                    eq: () => {
                        deleteCalledCount++;
                        return Promise.resolve({ error: null });
                    }
                })
            })
        } as any;

        return {
            stripe,
            supabase,
            getUpgradeCount: () => upgradeCalledCount,
            getInsertCount: () => insertCalledCount,
            getDeleteCount: () => deleteCalledCount
        };
    };

    await t.step("should skip processing if event is already recorded (idempotency)", async () => {
        const { stripe, supabase, getUpgradeCount } = setupMocks({ existing: true });
        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.skipped, true);
        assertEquals(getUpgradeCount(), 0, "Upgrade should NOT be called for duplicate event");
    });

    await t.step("should process if event is new", async () => {
        const { stripe, supabase, getUpgradeCount } = setupMocks({ existing: false });
        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.received, true);
        assertEquals(getUpgradeCount(), 1, "Upgrade should be called exactly once");
    });

    await t.step("should rollback idempotency record if processing fails", async () => {
        const { stripe, supabase, getDeleteCount } = setupMocks({ existing: false, updateStatus: 500 });

        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        assertEquals(res.status, 500);
        assertEquals(getDeleteCount(), 1, "Should delete idempotency record on failure to allow retries");
    });
});
