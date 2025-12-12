import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
)

serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature")
  const body = await req.text()

  try {
    const event = await stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")
    )

    console.log(`[Stripe Webhook] Received event: ${event.type}`)

    // Handle checkout completion - upgrade to Pro
    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const { userId, subscriptionId } = session.metadata

      console.log(`[Stripe] Upgrading user ${userId} to Pro`)
      const { error } = await supabase
        .from("user_profiles")
        .update({
          subscription_status: "pro",
          stripe_subscription_id: subscriptionId,
        })
        .eq("id", userId)

      if (error) {
        console.error(`[Stripe] Failed to upgrade user ${userId}:`, error)
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

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error(`[Stripe Webhook] Error:`, err)
    return new Response(err.message, { status: 400 })
  }
})
