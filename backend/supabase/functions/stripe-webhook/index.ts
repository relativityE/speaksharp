import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"

// Define types for dependency injection
type SupabaseClient = any; // Avoid importing full type for worker speed
type StripeClient = any;

export async function handler(
  req: Request,
  stripe: StripeClient,
  supabase: SupabaseClient,
  webhookSecret: string
) {
  const signature = req.headers.get("Stripe-Signature")
  const body = await req.text()

  try {
    const event = await stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    )

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`)

    // P0 FIX: Idempotency Check & Lock
    // We try to insert first. Unique constraint on 'event_id' handles the lock.
    const { error: insertError } = await supabase
      .from("processed_webhook_events")
      .insert({
        event_id: event.id,
        event_type: event.type,
        processed_at: new Date().toISOString(),
      })

    if (insertError) {
      // 23505 is PostgreSQL unique_violation
      if (insertError.code === "23505") {
        console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed or in progress, skipping`)
        return createSuccessResponse({ received: true, skipped: true }, {})
      }
      console.error(`[Stripe Webhook] Failed to record idempotency key for ${event.id}:`, insertError)
      // We still try to check if it exists just in case
      const { data: existing } = await supabase
        .from("processed_webhook_events")
        .select("id")
        .eq("event_id", event.id)
        .single()

      if (existing) {
        return createSuccessResponse({ received: true, skipped: true }, {})
      }

      // If it's some other DB error, we might want to fail so Stripe retries
      return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Idempotency check failed", {})
    }

    // Handle checkout completion - upgrade to Pro
    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const userId = session.metadata?.userId
      const subscriptionId = session.subscription

      if (!userId) {
        console.error("[Stripe] Missing userId in checkout session metadata")
        // We can't proceed without userId, but we already "locked" this event.
        // In a real system we might want to "unlock" if it's a permanent failure, 
        // but here it's likely a config error.
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
        // CRITICAL: Delete the idempotency record so Stripe retries can try again!
        await supabase.from("processed_webhook_events").delete().eq("event_id", event.id)

        return createErrorResponse(
          ErrorCodes.DATABASE_ERROR,
          `Failed to upgrade user: ${error.message}`,
          {}
        )
      } else {
        console.log(`[Stripe] ✅ User ${userId} upgraded to Pro successfully`)
      }
    }

    // Handle subscription cancellation - downgrade to Free
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
        // If it fails, delete lock so it can be retried
        await supabase.from("processed_webhook_events").delete().eq("event_id", event.id)
        return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Downgrade failed", {})
      }
    }

    // Handle subscription updates (e.g., payment method change, plan change)
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object
      const subscriptionId = subscription.id
      const status = subscription.status

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
          await supabase.from("processed_webhook_events").delete().eq("event_id", event.id)
          return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Status update failed", {})
        }
      }
    }

    // Handle payment failure - downgrade to Free after grace period
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object
      const subscriptionId = invoice.subscription
      const attemptCount = invoice.attempt_count || 0

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
          await supabase.from("processed_webhook_events").delete().eq("event_id", event.id)
          return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Payment failure handling failed", {})
        }
      }
    }

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
}

serve(async (req) => {
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!

  const stripe = new Stripe(stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  })

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  return handler(req, stripe, supabase, webhookSecret)
})
