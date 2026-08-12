import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@16"
import { createClient } from "npm:@supabase/supabase-js@2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { corsGuard, corsHeaders } from "../_shared/cors.ts"

type SupabaseClient = any;
type StripeClient = any;

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

const PRO_PRICE_EXPECTED_UNIT_AMOUNT = 1000;

// #1282 blocker 5/6: a GRANTING subscription must contain SpeakSharp's configured, validated $10 monthly
// price. Returns { ok } when an item matches STRIPE_PRO_PRICE_ID and that price is active + recurring every
// 1 month + exactly 1000 cents + configured currency. `retryable` means price identity is UNCERTAIN
// (retrieval failed) — the caller returns non-2xx so Stripe retries; a definitive mismatch is not retryable.
async function validateSubscriptionPrice(
  stripe: StripeClient,
  subscription: any,
  getEnv: (k: string) => string | undefined,
): Promise<{ ok: boolean; retryable: boolean; reason?: string }> {
  const expectedId = getEnv("STRIPE_PRO_PRICE_ID")?.trim();
  if (!expectedId) return { ok: false, retryable: false, reason: "missing STRIPE_PRO_PRICE_ID" };
  const items: any[] = subscription?.items?.data ?? [];
  const item = items.find((i) => normalizeStripeObjectId(i?.price) === expectedId);
  if (!item) return { ok: false, retryable: false, reason: "subscription has no item for the configured price" };

  let price: any = item.price && typeof item.price === "object" ? item.price : null;
  if (!price || price.unit_amount === undefined) {
    try { price = await stripe.prices.retrieve(expectedId); }
    catch { return { ok: false, retryable: true, reason: "price retrieval failed" }; }
  }
  const expectedCurrency = (getEnv("STRIPE_PRICE_CURRENCY") ?? "usd").trim().toLowerCase();
  const problems: string[] = [];
  if (price?.active !== true) problems.push(`active:${price?.active ?? "missing"}`);
  if (price?.recurring?.interval !== "month") problems.push(`interval:${price?.recurring?.interval ?? "none"}`);
  if (price?.recurring?.interval_count !== 1) problems.push(`interval_count:${price?.recurring?.interval_count ?? "none"}`);
  if (price?.unit_amount !== PRO_PRICE_EXPECTED_UNIT_AMOUNT) problems.push(`unit_amount:${price?.unit_amount ?? "none"}`);
  if ((price?.currency ?? "").toLowerCase() !== expectedCurrency) problems.push(`currency:${price?.currency ?? "none"}`);
  return problems.length ? { ok: false, retryable: false, reason: problems.join(",") } : { ok: true, retryable: false };
}

export async function handler(
  req: Request,
  stripe: StripeClient,
  supabase: SupabaseClient,
  webhookSecret: string,
  getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k),
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

    // #1282 blocker 5 (design lock): entitlement is decided by the CURRENT Stripe subscription state, never
    // by event action or arrival order (Stripe does not guarantee delivery order and recommends retrieving
    // current objects). We resolve the subscription id from the event, HYDRATE the current subscription,
    // VALIDATE the configured $10/mo price for granting states, then apply a canonical snapshot.
    let subscriptionId: string | null = null;
    let bindUserId: string | null = null; // first-activation binding uses server-created checkout metadata

    switch (event.type) {
      case "checkout.session.completed": {
        // checkout.session.completed ALONE does NOT grant access — we hydrate + validate the subscription
        // below. First account binding uses the server-created metadata.userId; later events use the
        // stored subscription/customer identity (no metadata needed).
        const session = event.data.object;
        bindUserId = session?.metadata?.userId ?? null;
        subscriptionId = normalizeStripeObjectId(session?.subscription);
        if (!bindUserId) {
          console.error("[Stripe] Missing userId in checkout session metadata");
          return createErrorResponse(ErrorCodes.VALIDATION_MISSING_METADATA, "Missing userId metadata", responseHeaders);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        subscriptionId = normalizeStripeObjectId(event.data.object);
        break;
      }
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        subscriptionId = normalizeStripeObjectId(event.data.object?.subscription);
        break;
      }
      default:
        // Not a subscription-state event — acknowledge and ignore (nothing to reconcile).
        return createSuccessResponse({ received: true, ignored: event.type }, responseHeaders);
    }

    if (!subscriptionId) {
      // A subscription-related event carrying no subscription id (e.g. a one-off invoice): nothing to apply.
      return createSuccessResponse({ received: true, no_subscription: true }, responseHeaders);
    }

    // HYDRATE the current subscription. Retrieval uncertainty is retryable -> non-2xx (Stripe retries).
    let subscription: any;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (retrieveErr) {
      console.error(`[Stripe Webhook] subscription retrieve failed for ${subscriptionId}:`, retrieveErr);
      return createErrorResponse(ErrorCodes.STRIPE_API_ERROR, "Unable to retrieve subscription", responseHeaders);
    }

    const status = String(subscription?.status ?? "");
    const customerId = normalizeStripeObjectId(subscription?.customer);
    const cancelAtPeriodEnd = subscription?.cancel_at_period_end === true;
    const currentPeriodEnd = typeof subscription?.current_period_end === "number" ? subscription.current_period_end : null;
    // Only active/trialing grant paid access; past_due/unpaid/incomplete/incomplete_expired/paused/canceled
    // do not. cancel_at_period_end with an 'active' status keeps access until the period-end 'canceled' snapshot.
    const grantingStatus = status === "active" || status === "trialing";

    // A GRANTING subscription MUST contain the configured, validated $10 monthly price. Price uncertainty is
    // retryable (non-2xx); a definitive price mismatch cannot grant paid access (non-2xx, surfaced).
    if (grantingStatus) {
      const priceCheck = await validateSubscriptionPrice(stripe, subscription, getEnv);
      if (priceCheck.retryable) {
        console.error(`[Stripe Webhook] price uncertain for ${subscriptionId}: ${priceCheck.reason}`);
        return createErrorResponse(ErrorCodes.STRIPE_API_ERROR, "Unable to verify subscription price", responseHeaders);
      }
      if (!priceCheck.ok) {
        console.error(`[Stripe Webhook] active subscription lacks the configured price (${priceCheck.reason})`);
        return createErrorResponse(ErrorCodes.CONFIG_INVALID_PRICE, "Subscription does not match the configured Pro price", responseHeaders);
      }
    }

    // Apply the CANONICAL snapshot (the DB maps the current status to entitlement). DB uncertainty is
    // retryable -> non-2xx; the snapshot RPC is idempotent per event id.
    const { data, error } = await supabase.rpc('apply_stripe_subscription_snapshot', {
      p_event_id: event.id,
      p_subscription_id: subscriptionId,
      p_customer_id: customerId,
      p_status: status,
      p_cancel_at_period_end: cancelAtPeriodEnd,
      p_current_period_end: currentPeriodEnd,
      p_user_id: bindUserId,
      p_event_created: typeof event.created === 'number' ? event.created : null,
    });

    if (error || (data && data.success === false)) {
      console.error(`[Stripe Webhook] snapshot application failed for ${event.id}:`, error ?? data?.error);
      return createErrorResponse(ErrorCodes.DATABASE_ERROR, "Snapshot application failed", responseHeaders);
    }

    if (data?.skipped) {
      console.log(`[Stripe Webhook] ⏭️ Event ${event.id} already processed, skipping`);
      return createSuccessResponse({ received: true, skipped: true }, responseHeaders);
    }

    console.log(`[Stripe Webhook] ✅ Event ${event.id} applied snapshot (status=${status}, entitlement=${data?.entitlement})`);
    return createSuccessResponse({ received: true, entitlement: data?.entitlement }, responseHeaders);

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
