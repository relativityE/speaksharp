/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for stripe-webhook Edge Function.
 * 
 * Strategy: Test business logic (subscription updates) without mocking Stripe signature verification.
 * The signature verification is Stripe SDK's responsibility - we trust it.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ============================================================================
// Extracted Handler Functions (for testing)
// ============================================================================

interface MockSupabase {
    from: (table: string) => {
        update: (data: any) => {
            eq: (field: string, value: string) => Promise<{ error: any }>;
        };
    };
}

/**
 * Handle checkout.session.completed event - upgrade user to Pro
 */
export async function handleCheckoutCompleted(
    session: { metadata?: { userId?: string }; subscription?: string },
    supabase: MockSupabase
): Promise<{ success: boolean; error?: string }> {
    const userId = session.metadata?.userId;
    const subscriptionId = session.subscription;

    if (!userId) {
        return { success: false, error: "Missing userId metadata" };
    }

    const { error } = await supabase
        .from("user_profiles")
        .update({
            subscription_status: "pro",
            stripe_subscription_id: subscriptionId,
        })
        .eq("id", userId);

    if (error) {
        return { success: false, error: error.message };
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
    const { error } = await supabase
        .from("user_profiles")
        .update({
            subscription_status: "free",
            stripe_subscription_id: null,
        })
        .eq("stripe_subscription_id", subscription.id);

    if (error) {
        return { success: false, error: error.message };
    }

    return { success: true };
}

// ============================================================================
// Tests
// ============================================================================

Deno.test("stripe-webhook handlers", async (t) => {
    // Mock Supabase client that succeeds
    const mockSuccessSupabase: MockSupabase = {
        from: () => ({
            update: () => ({
                eq: () => Promise.resolve({ error: null }),
            }),
        }),
    };

    // Mock Supabase client that fails
    const mockFailSupabase: MockSupabase = {
        from: () => ({
            update: () => ({
                eq: () => Promise.resolve({ error: { message: "DB Error" } }),
            }),
        }),
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

    const { error } = await supabase
        .from("user_profiles")
        .update({ subscription_status: "free" })
        .eq("stripe_subscription_id", subscription.id);

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

    const { error } = await supabase
        .from("user_profiles")
        .update({ subscription_status: "free" })
        .eq("stripe_subscription_id", invoice.subscription);

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
        from: () => ({
            update: () => ({
                eq: () => Promise.resolve({ error: null }),
            }),
        }),
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
        from: () => ({
            update: () => ({
                eq: () => Promise.resolve({ error: null }),
            }),
        }),
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
