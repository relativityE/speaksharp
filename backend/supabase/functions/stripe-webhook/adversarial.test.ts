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

    const setupMocks = (options: { skipped?: boolean, success?: boolean } = {}) => {
        let rpcCalledCount = 0;
        let capturedArgs: any;

        const stripe = {
            webhooks: {
                constructEvent: () => Promise.resolve(mockEvent)
            }
        };

        const supabase = {
            rpc: (_fn: string, args: Record<string, unknown>) => {
                rpcCalledCount++;
                capturedArgs = args;
                if (options.success === false) {
                    return Promise.resolve({ data: { success: false, error: 'DB Down' }, error: null });
                }
                return Promise.resolve({
                    data: {
                        success: true,
                        skipped: Boolean(options.skipped),
                    },
                    error: null,
                });
            },
        } as any;

        return {
            stripe,
            supabase,
            getRpcCount: () => rpcCalledCount,
            getCapturedArgs: () => capturedArgs,
        };
    };

    await t.step("should skip processing if event is already recorded (idempotency)", async () => {
        const { stripe, supabase, getRpcCount } = setupMocks({ skipped: true });
        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.skipped, true);
        assertEquals(getRpcCount(), 1, "Atomic webhook RPC should be called once for duplicate event");
    });

    await t.step("should process if event is new", async () => {
        const { stripe, supabase, getCapturedArgs } = setupMocks();
        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.received, true);
        assertEquals(getCapturedArgs()?.p_action, 'upgrade_to_pro');
        assertEquals(getCapturedArgs()?.p_event_id, mockEvent.id);
    });

    await t.step("should not upgrade paid Basic checkout events to Pro", async () => {
        const basicEvent = {
            ...mockEvent,
            id: 'evt_basic_123',
            data: {
                object: {
                    metadata: { userId: 'user_123', plan: 'basic' },
                    subscription: 'sub_basic_123'
                }
            }
        };

        const stripe = {
            webhooks: {
                constructEvent: () => Promise.resolve(basicEvent)
            }
        };
        let capturedArgs: any;
        const supabase = {
            rpc: (_fn: string, args: Record<string, unknown>) => {
                capturedArgs = args;
                return Promise.resolve({ data: { success: true, skipped: false }, error: null });
            },
        } as any;

        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(basicEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        const json = await res.json();

        assertEquals(res.status, 200);
        assertEquals(json.received, true);
        assertEquals(capturedArgs?.p_action, 'activate_basic');
        assertEquals(capturedArgs?.p_subscription_id, 'sub_basic_123');
    });

    await t.step("should fail if atomic webhook RPC reports action failure", async () => {
        const { stripe, supabase, getRpcCount } = setupMocks({ success: false });

        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Stripe-Signature': 'fake' },
            body: JSON.stringify(mockEvent)
        });

        const res = await handler(req, stripe, supabase, 'secret');
        assertEquals(res.status, 500);
        assertEquals(getRpcCount(), 1, "Atomic webhook RPC owns idempotency and action rollback");
    });
});
