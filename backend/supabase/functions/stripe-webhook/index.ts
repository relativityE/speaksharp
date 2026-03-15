import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"

type SupabaseClient = any;
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

    let action = 'none';
    let userId = null;
    let subscriptionId = null;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        userId = session.metadata?.userId
        subscriptionId = session.subscription

        if (!userId) {
          console.error("[Stripe] Missing userId in checkout session metadata")
          return createErrorResponse(
            ErrorCodes.VALIDATION_MISSING_METADATA,
            "Missing userId metadata",
            {}
          )
        }
        action = 'upgrade_to_pro';
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object
        subscriptionId = subscription.id
        action = 'downgrade_to_free';
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object
        subscriptionId = subscription.id
        const status = subscription.status

        if (status === "canceled" || status === "unpaid" || status === "past_due") {
          action = 'downgrade_to_free';
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object
        subscriptionId = invoice.subscription
        const attemptCount = invoice.attempt_count || 0

        if (attemptCount >= 3 && subscriptionId) {
          action = 'downgrade_to_free';
        }
        break;
      }
    }

    // Call RPC to execute idempotency and action atomically
    const { data, error } = await supabase.rpc('process_stripe_webhook_event', {
      p_event_id: event.id,
      p_event_type: event.type,
      p_action: action,
      p_user_id: userId,
      p_subscription_id: subscriptionId
    });

    if (error) {
      console.error(`[Stripe Webhook] RPC execution failed for ${event.id}:`, error)
      return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Processing failed", {})
    }

    if (data?.skipped) {
      console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed, skipping`)
      return createSuccessResponse({ received: true, skipped: true }, {})
    }

    if (data?.success === false) {
       console.error(`[Stripe Webhook] RPC action failed for ${event.id}:`, data.error)
       return createErrorResponse(ErrorCodes.DATABASE_ERROR, data.error || "Action failed", {})
    }

    if (action === 'upgrade_to_pro') {
      console.log(`[Stripe] ✅ User ${userId} upgraded to Pro successfully`)
    } else if (action === 'downgrade_to_free') {
      console.log(`[Stripe] ✅ Subscription ${subscriptionId} downgraded successfully`)
    }

    console.log(`[Stripe Webhook] ✅ Event ${event.id} processed successfully`);
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
