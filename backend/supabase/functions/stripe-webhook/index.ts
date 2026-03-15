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

    // Extract necessary data from different events
    let userId: string | null = null;
    let subscriptionId: string | null = null;
    let status: string | null = null;
    let attemptCount = 0;

    switch (event.type) {
      case "checkout.session.completed":
        userId = event.data.object.metadata?.userId || null;
        subscriptionId = event.data.object.subscription || null;
        break;
      case "customer.subscription.deleted":
        subscriptionId = event.data.object.id || null;
        break;
      case "customer.subscription.updated":
        subscriptionId = event.data.object.id || null;
        status = event.data.object.status || null;
        break;
      case "invoice.payment_failed":
        subscriptionId = event.data.object.subscription || null;
        attemptCount = event.data.object.attempt_count || 0;
        break;
    }

    // P0 FIX: Atomize Idempotency Check & User Profile Update using PostgreSQL RPC
    const { data, error } = await supabase.rpc("process_stripe_webhook_event", {
      p_event_id: event.id,
      p_event_type: event.type,
      p_user_id: userId,
      p_subscription_id: subscriptionId,
      p_status: status,
      p_attempt_count: attemptCount,
    })

    if (error) {
      console.error(`[Stripe Webhook] Failed to process event ${event.id}:`, error)

      if (error.message?.includes('Missing userId metadata')) {
        return createErrorResponse(
          ErrorCodes.VALIDATION_MISSING_METADATA,
          "Missing userId metadata",
          {}
        )
      }
      return createErrorResponse(
        ErrorCodes.DATABASE_ERROR,
        `Webhook processing failed: ${error.message}`,
        {}
      )
    }

    if (data?.skipped) {
      console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed or in progress, skipping`)
      return createSuccessResponse({ received: true, skipped: true }, {})
    }

    // Success Logs
    if (data?.action === 'upgraded') {
      console.log(`[Stripe] ✅ User ${userId} upgraded to Pro successfully (subscription: ${subscriptionId})`)
    } else if (data?.action === 'downgraded') {
      console.log(`[Stripe] Subscription ${subscriptionId} downgraded user to free`)
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

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const stripe = new Stripe(stripeSecretKey, {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

serve(async (req) => {
  return handler(req, stripe, supabase, webhookSecret)
})
