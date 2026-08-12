import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@16"
import { createClient } from "npm:@supabase/supabase-js@2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { corsGuard, corsHeaders } from "../_shared/cors.ts"

type SupabaseClient = any;
type StripeClient = any;
type BillingPlan = 'basic' | 'pro';

function normalizeBillingPlan(value: unknown): BillingPlan {
  return typeof value === 'string' && value.toLowerCase() === 'basic' ? 'basic' : 'pro';
}

function actionForPlan(plan: BillingPlan) {
  return plan === 'basic' ? 'activate_basic' : 'upgrade_to_pro';
}

function normalizeStripeObjectId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

export async function handler(
  req: Request,
  stripe: StripeClient,
  supabase: SupabaseClient,
  webhookSecret: string
) {
  // Stripe → server webhooks send NO Origin, so corsGuard lets them through untouched (server-to-
  // server behavior preserved). It only rejects a browser request carrying a hostile/unapproved
  // Origin, before signature verification or any DB write — such requests are never legitimate here.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

  const responseHeaders = corsHeaders(req)

  const signature = req.headers.get("Stripe-Signature")
  const body = await req.text()

  try {
    const event = await constructStripeEvent(stripe, body, signature, webhookSecret)

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`)

    let action = 'none';
    let userId: string | null = null;
    let subscriptionId: string | null = null;
    let stripeCustomerId: string | null = null;
    let plan: BillingPlan = 'pro';

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        userId = session.metadata?.userId
        subscriptionId = normalizeStripeObjectId(session.subscription)
        stripeCustomerId = normalizeStripeObjectId(session.customer)
        plan = normalizeBillingPlan(session.metadata?.plan)

        if (!userId) {
          console.error("[Stripe] Missing userId in checkout session metadata")
          return createErrorResponse(
            ErrorCodes.VALIDATION_MISSING_METADATA,
            "Missing userId metadata",
            responseHeaders
          )
        }
        action = actionForPlan(plan);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object
        subscriptionId = subscription.id
        stripeCustomerId = normalizeStripeObjectId(subscription.customer)
        action = 'downgrade_to_free';
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object
        subscriptionId = subscription.id
        stripeCustomerId = normalizeStripeObjectId(subscription.customer)
        const status = subscription.status
        userId = subscription.metadata?.userId ?? null
        plan = normalizeBillingPlan(subscription.metadata?.plan)

        if (status === "canceled") {
          // Terminal cancellation — clears the subscription id (not recoverable via renewal).
          action = 'downgrade_to_free';
        } else if (status === "unpaid" || status === "past_due") {
          // Recoverable lapse — suspends access but PRESERVES the subscription id so a later
          // invoice.payment_succeeded (renew_pro) can restore Pro after the customer recovers.
          action = 'lapse_pro';
        } else if (status === "active" && userId) {
          // Active keeps Pro. #1282 cancel-through-period-end: an active subscription flagged
          // cancel_at_period_end stays Pro here (access continues); the customer.subscription.deleted
          // that fires at period end runs the downgrade. Re-affirming Pro also advances the
          // out-of-order watermark so a stale earlier event cannot regress it.
          action = actionForPlan(plan);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        // #1282 RENEWAL. A successful renewal invoice re-affirms Pro for the subscription and clears a
        // prior past-due lapse. Keyed on the subscription id (renewal invoices carry no userId
        // metadata). The initial subscription invoice is already handled by checkout.session.completed;
        // renew_pro is idempotent, so processing it here is harmless if they race.
        const invoice = event.data.object
        subscriptionId = normalizeStripeObjectId(invoice.subscription)
        stripeCustomerId = normalizeStripeObjectId(invoice.customer)
        const billingReason = invoice.billing_reason
        if (subscriptionId && (billingReason === 'subscription_cycle' || billingReason === 'subscription_update')) {
          action = 'renew_pro';
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object
        subscriptionId = normalizeStripeObjectId(invoice.subscription)
        stripeCustomerId = normalizeStripeObjectId(invoice.customer)
        const attemptCount = invoice.attempt_count || 0

        if (attemptCount >= 3 && subscriptionId) {
          // Recoverable lapse, not terminal cancellation: suspend access but keep the subscription id
          // so a subsequent successful payment (renew_pro) restores Pro. Stripe emits
          // customer.subscription.deleted at true end-of-life, which clears the id via downgrade_to_free.
          action = 'lapse_pro';
        }
        break;
      }
    }

    // Call RPC to execute idempotency and action atomically. p_event_created carries the Stripe event
    // ordering authority (unix seconds) for the server-side out-of-order guard.
    const { data, error } = await supabase.rpc('process_stripe_webhook_event', {
      p_event_id: event.id,
      p_event_type: event.type,
      p_action: action,
      p_user_id: userId,
      p_subscription_id: subscriptionId,
      p_stripe_customer_id: stripeCustomerId,
      p_event_created: typeof event.created === 'number' ? event.created : null
    });

    if (error) {
      console.error(`[Stripe Webhook] RPC execution failed for ${event.id}:`, error)
      return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Processing failed", responseHeaders)
    }

    if (data?.skipped) {
      console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed, skipping`)
      return createSuccessResponse({ received: true, skipped: true }, responseHeaders)
    }

    if (data?.success === false) {
       console.error(`[Stripe Webhook] RPC action failed for ${event.id}:`, data.error)
       return createErrorResponse(ErrorCodes.DATABASE_ERROR, data.error || "Action failed", responseHeaders)
    }

    if (data?.warning) {
      console.warn(`[Stripe Webhook] ⚠️ Event ${event.id} processed with warning:`, data.warning)
    }

    if (action === 'upgrade_to_pro') {
      console.log(`[Stripe] ✅ User ${userId} upgraded to Pro successfully`)
    } else if (action === 'activate_basic') {
      console.log(`[Stripe] ✅ User ${userId} activated paid Basic successfully`)
    } else if (action === 'downgrade_to_free') {
      console.log(`[Stripe] ✅ Subscription ${subscriptionId} downgraded to Free successfully`)
    }

    console.log(`[Stripe Webhook] ✅ Event ${event.id} processed successfully`);
    return createSuccessResponse({ received: true }, responseHeaders)

  } catch (err) {
    const error = err as Error
    console.error(`[Stripe Webhook] Error:`, error)
    return createErrorResponse(
      ErrorCodes.STRIPE_WEBHOOK_INVALID,
      "Webhook processing failed",
      responseHeaders
    )
  }
}

async function constructStripeEvent(
  stripe: StripeClient,
  body: string,
  signature: string | null,
  webhookSecret: string
) {
  if (typeof stripe.webhooks.constructEventAsync === "function") {
    return await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret)
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

async function createRuntime() {
  const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY")
  const webhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET")
  const supabaseUrl = getRequiredEnv("SUPABASE_URL")
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")

  return {
    webhookSecret,
    stripe: new Stripe(stripeSecretKey, {
      httpClient: Stripe.createFetchHttpClient(),
    }),
    supabase: createClient(supabaseUrl, supabaseServiceRoleKey),
  }
}

if (import.meta.main) {
  let runtimePromise: ReturnType<typeof createRuntime> | null = null

  serve(async (req) => {
    try {
      runtimePromise ??= createRuntime()
      const runtime = await runtimePromise
      return handler(req, runtime.stripe, runtime.supabase, runtime.webhookSecret)
    } catch (err) {
      const error = err as Error
      console.error("[Stripe Webhook] Configuration error:", error)
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Stripe webhook is not configured",
        {},
        { reason: error.message }
      )
    }
  })
}
