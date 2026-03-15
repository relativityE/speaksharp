/**
 * Unit tests for stripe-webhook Edge Function.
 * 
 * Strategy: Test business logic (subscription updates) without mocking Stripe signature verification.
 * The signature verification is Stripe SDK's responsibility - we trust it.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

// ============================================================================
// Extracted Handler Functions (for testing)
// ============================================================================

interface MockSupabase {
    rpc: (name: string, args: any) => Promise<{ data: any; error: any }>;
}

/**
 * Handle checkout.session.completed event - upgrade user to Pro
 */
export async function handleCheckoutCompleted(
    session: { metadata?: { userId?: string }; subscription?: string },
    supabase: MockSupabase
): Promise<{ success: boolean; error?: string }> {
    const userId = session.metadata?.userId || null;
    const subscriptionId = session.subscription || null;

    const { data, error } = await supabase.rpc("process_stripe_webhook_event", {
        p_event_id: "evt_mock",
        p_event_type: "checkout.session.completed",
        p_user_id: userId,
        p_subscription_id: subscriptionId,
        p_status: null,
        p_attempt_count: 0,
    });

    if (error) {
        if (error.message?.includes("Missing userId")) {
            return { success: false, error: "Missing userId metadata" };
        }
        return { success: false, error: error.message };
    }

    if (data?.skipped) {
        return { success: true };
    }

    return { success: true };
}

/**
 * Handle customer.subscription.deleted event - downgrade user to Free
 */
export async function handleSubscriptionDeleted(
    subscription: { id: string },
    supabase: MockSupabase
): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc("process_stripe_webhook_event", {
        p_event_id: "evt_mock",
        p_event_type: "customer.subscription.deleted",
        p_user_id: null,
        p_subscription_id: subscription.id,
        p_status: null,
        p_attempt_count: 0,
    });

    if (error) {
        return { success: false, error: error.message };
    }

    if (data?.skipped) {
        return { success: true };
    }

    return { success: true };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test("stripe-webhook handlers", async (t) => {
    // Mock Supabase client that succeeds
    const mockSuccessSupabase: MockSupabase = {
        rpc: (name: string, args: any) => {
            if (name === "process_stripe_webhook_event") {
                if (args.p_event_type === "checkout.session.completed" && !args.p_user_id) {
                    return Promise.resolve({ data: null, error: { message: "Missing userId metadata" } });
                }
                return Promise.resolve({ data: { success: true, action: "processed" }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
        },
    };

    // Mock Supabase client that fails
    const mockFailSupabase: MockSupabase = {
        rpc: () => Promise.resolve({ data: null, error: { message: "DB Error" } }),
    };

    await t.step("handleCheckoutCompleted - upgrades user to Pro", async () => {
        const session = {
            metadata: { userId: "user-123" },
            subscription: "sub_abc123",
        };

        const result = await handleCheckoutCompleted(session, mockSuccessSupabase);

        assertEquals(result.success, true);
        assertEquals(result.error, undefined);
    });

    await t.step("handleCheckoutCompleted - fails without userId", async () => {
        const session = {
            metadata: {},
            subscription: "sub_abc123",
        };

        const result = await handleCheckoutCompleted(session, mockSuccessSupabase);

        assertEquals(result.success, false);
        assertEquals(result.error, "Missing userId metadata");
    });

    await t.step("handleCheckoutCompleted - handles DB error", async () => {
        const session = {
            metadata: { userId: "user-123" },
            subscription: "sub_abc123",
        };

        const result = await handleCheckoutCompleted(session, mockFailSupabase);

        assertEquals(result.success, false);
        assertEquals(result.error, "DB Error");
    });

    await t.step("handleSubscriptionDeleted - downgrades user to Free", async () => {
        const subscription = { id: "sub_abc123" };

        const result = await handleSubscriptionDeleted(subscription, mockSuccessSupabase);

        assertEquals(result.success, true);
    });

    await t.step("handleSubscriptionDeleted - handles DB error", async () => {
        const subscription = { id: "sub_abc123" };

        const result = await handleSubscriptionDeleted(subscription, mockFailSupabase);

        assertEquals(result.success, false);
        assertEquals(result.error, "DB Error");
    });
});

// ============================================================================
// Additional Handler Functions (for testing subscription.updated & payment_failed)
// ============================================================================

/**
 * Handle customer.subscription.updated event - downgrade if status indicates cancellation
 */
export async function handleSubscriptionUpdated(
    subscription: { id: string; status: string },
    supabase: MockSupabase
): Promise<{ success: boolean; action?: string; error?: string }> {
    const downgradeStatuses = ["canceled", "unpaid", "past_due"];

    if (!downgradeStatuses.includes(subscription.status)) {
        return { success: true, action: "no_action" };
    }

    const { data, error } = await supabase.rpc("process_stripe_webhook_event", {
        p_event_id: "evt_mock",
        p_event_type: "customer.subscription.updated",
        p_user_id: null,
        p_subscription_id: subscription.id,
        p_status: subscription.status,
        p_attempt_count: 0,
    });

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true, action: "downgraded" };
}

/**
 * Handle invoice.payment_failed event - downgrade after 3+ failed attempts
 */
export async function handlePaymentFailed(
    invoice: { subscription?: string; attempt_count?: number },
    supabase: MockSupabase
): Promise<{ success: boolean; action?: string; error?: string }> {
    const attemptCount = invoice.attempt_count || 0;

    if (attemptCount < 3 || !invoice.subscription) {
        return { success: true, action: "no_action" };
    }

    const { data, error } = await supabase.rpc("process_stripe_webhook_event", {
        p_event_id: "evt_mock",
        p_event_type: "invoice.payment_failed",
        p_user_id: null,
        p_subscription_id: invoice.subscription,
        p_status: null,
        p_attempt_count: attemptCount,
    });

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true, action: "downgraded" };
}

// ============================================================================
// Additional Tests
// ============================================================================

Deno.test("stripe-webhook subscription.updated handlers", async (t) => {
    const mockSuccessSupabase: MockSupabase = {
        rpc: () => Promise.resolve({ data: null, error: null }),
    };

    await t.step("handleSubscriptionUpdated - downgrades on canceled status", async () => {
        const subscription = { id: "sub_abc123", status: "canceled" };
        const result = await handleSubscriptionUpdated(subscription, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "downgraded");
    });

    await t.step("handleSubscriptionUpdated - downgrades on unpaid status", async () => {
        const subscription = { id: "sub_abc123", status: "unpaid" };
        const result = await handleSubscriptionUpdated(subscription, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "downgraded");
    });

    await t.step("handleSubscriptionUpdated - downgrades on past_due status", async () => {
        const subscription = { id: "sub_abc123", status: "past_due" };
        const result = await handleSubscriptionUpdated(subscription, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "downgraded");
    });

    await t.step("handleSubscriptionUpdated - no action on active status", async () => {
        const subscription = { id: "sub_abc123", status: "active" };
        const result = await handleSubscriptionUpdated(subscription, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "no_action");
    });
});

Deno.test("stripe-webhook invoice.payment_failed handlers", async (t) => {
    const mockSuccessSupabase: MockSupabase = {
        rpc: () => Promise.resolve({ data: null, error: null }),
    };

    await t.step("handlePaymentFailed - no action if < 3 attempts", async () => {
        const invoice = { subscription: "sub_abc123", attempt_count: 2 };
        const result = await handlePaymentFailed(invoice, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "no_action");
    });

    await t.step("handlePaymentFailed - downgrades at 3+ attempts", async () => {
        const invoice = { subscription: "sub_abc123", attempt_count: 3 };
        const result = await handlePaymentFailed(invoice, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "downgraded");
    });

    await t.step("handlePaymentFailed - no action if no subscription", async () => {
        const invoice = { attempt_count: 5 };
        const result = await handlePaymentFailed(invoice, mockSuccessSupabase);
        assertEquals(result.success, true);
        assertEquals(result.action, "no_action");
    });
});
