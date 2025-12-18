import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
)

/**
 * P0 FIX: Idempotency check using event.id
 * Prevents duplicate processing of the same webhook event.
 * Returns true if event was already processed, false if new.
 */
async function isEventProcessed(eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("processed_webhook_events")
    .select("id")
    .eq("event_id", eventId)
    .single()

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows found - that's expected for new events
    console.error(`[Stripe Webhook] Error checking idempotency:`, error)
  }

  return !!data
}

/**
 * P0 FIX: Record processed event for idempotency
 */
async function markEventProcessed(eventId: string, eventType: string): Promise<void> {
  const { error } = await supabase
    .from("processed_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      processed_at: new Date().toISOString(),
    })

  if (error) {
    // Unique constraint violation means it was already processed (race condition - safe)
    if (error.code === "23505") {
      console.log(`[Stripe Webhook] Event ${eventId} already recorded (concurrent request)`)
    } else {
      console.error(`[Stripe Webhook] Failed to record event ${eventId}:`, error)
    }
  }
}

serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature")
  const body = await req.text()

  try {
    const event = await stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")
    )

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`)

    // P0 FIX: Idempotency check - skip if already processed
    if (await isEventProcessed(event.id)) {
      console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed, skipping`)
      return createSuccessResponse({ received: true, skipped: true }, {})
    }

    // Handle checkout completion - upgrade to Pro
    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const userId = session.metadata?.userId
      const subscriptionId = session.subscription

      if (!userId) {
        console.error("[Stripe] Missing userId in checkout session metadata")
        return createErrorResponse(
          ErrorCodes.VALIDATION_MISSING_METADATA,
          "Missing userId metadata",
          {}
        )
      }

      console.log(`[Stripe] Upgrading user ${userId} to Pro (subscription: ${subscriptionId})`)
      const { error } = await supabase
        .from("user_profiles")
        .update({
          subscription_status: "pro",
          stripe_subscription_id: subscriptionId,
        })
        .eq("id", userId)

      if (error) {
        console.error(`[Stripe] Failed to upgrade user ${userId}:`, error)
        return createErrorResponse(
          ErrorCodes.DATABASE_ERROR,
          `Failed to upgrade user: ${error.message}`,
          {}
        )
      } else {
        console.log(`[Stripe] ✅ User ${userId} upgraded to Pro successfully`)
      }
    }

    // P0 FIX: Handle subscription cancellation - downgrade to Free
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object
      const subscriptionId = subscription.id

      console.log(`[Stripe] Subscription ${subscriptionId} cancelled, downgrading user`)
      const { error } = await supabase
        .from("user_profiles")
        .update({
          subscription_status: "free",
          stripe_subscription_id: null,
        })
        .eq("stripe_subscription_id", subscriptionId)

      if (error) {
        console.error(`[Stripe] Failed to downgrade subscription ${subscriptionId}:`, error)
      }
    }

    // P0 FIX: Handle subscription updates (e.g., payment method change, plan change)
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object
      const subscriptionId = subscription.id
      const status = subscription.status

      // If subscription is no longer active, downgrade
      if (status === "canceled" || status === "unpaid" || status === "past_due") {
        console.log(`[Stripe] Subscription ${subscriptionId} status changed to ${status}, downgrading`)
        const { error } = await supabase
          .from("user_profiles")
          .update({
            subscription_status: "free",
          })
          .eq("stripe_subscription_id", subscriptionId)

        if (error) {
          console.error(`[Stripe] Failed to update subscription ${subscriptionId}:`, error)
        }
      }
    }

    // P0 FIX: Handle payment failure - downgrade to Free after grace period
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object
      const subscriptionId = invoice.subscription
      const attemptCount = invoice.attempt_count || 0

      // After 3 failed attempts, downgrade the user
      if (attemptCount >= 3 && subscriptionId) {
        console.log(`[Stripe] Payment failed ${attemptCount} times for subscription ${subscriptionId}, downgrading`)
        const { error } = await supabase
          .from("user_profiles")
          .update({
            subscription_status: "free",
          })
          .eq("stripe_subscription_id", subscriptionId)

        if (error) {
          console.error(`[Stripe] Failed to downgrade after payment failure:`, error)
        }
      } else {
        console.log(`[Stripe] Payment attempt ${attemptCount} failed for subscription ${subscriptionId}, not downgrading yet`)
      }
    }

    // P0 FIX: Mark event as processed for idempotency
    await markEventProcessed(event.id, event.type)

    return createSuccessResponse({ received: true }, {})
  } catch (err) {
    const error = err as Error
    console.error(`[Stripe Webhook] Error:`, error)
    return createErrorResponse(
      ErrorCodes.STRIPE_WEBHOOK_INVALID,
      error.message || "Webhook processing failed",
      {}
    )
  }
})
