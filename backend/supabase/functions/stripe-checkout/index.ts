import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@16"
import { createClient } from "npm:@supabase/supabase-js@2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { corsHeaders as buildCorsHeaders } from "../_shared/cors.ts"

// Port configuration for local development fallback (inlined to avoid bundler issues)
const DEV_PORT = 5174;

// Defensive Stripe initialization - validate env before crash
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY && import.meta.main) {
  console.error("FATAL: STRIPE_SECRET_KEY environment variable is not set.");
}

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
  : null;

type CheckoutPlan = "basic" | "pro";
type EnvGetter = (key: string) => string | undefined;
type SupabaseFactory = (authHeader: string) => ReturnType<typeof createClient>;
type StripeLike = {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{ id: string; url: string | null }>;
    };
  };
};

type HandlerDeps = {
  getEnv?: EnvGetter;
  createSupabase?: SupabaseFactory;
  stripeClient?: StripeLike | null;
};

const normalizePlan = (value: unknown): CheckoutPlan | null => {
  if (typeof value !== "string") return "pro";
  const normalized = value.trim().toLowerCase();
  if (normalized === "basic" || normalized === "pro") return normalized;
  return null;
};

const sanitizeMetadataValue = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
  return normalized || fallback;
};

const fetchExistingStripeCustomerId = async (
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const profile = data as { stripe_customer_id?: unknown } | null;
  const customerId = typeof profile?.stripe_customer_id === "string"
    ? profile.stripe_customer_id.trim()
    : "";
  return customerId || null;
};

export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const responseHeaders = buildCorsHeaders(req);
  const getEnv: EnvGetter = deps.getEnv ?? ((key) => Deno.env.get(key) ?? undefined);
  const stripeClient = deps.stripeClient ?? stripe;
  const createSupabaseClient: SupabaseFactory = deps.createSupabase ?? ((authHeader) =>
    createClient(
      getEnv("SUPABASE_URL")!,
      getEnv("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )
  );

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders })
  }

  try {
    // DIAGNOSTIC LOGGING
    console.log('[Stripe Checkout] 🔍 Starting request processing');

    // 1. Verify Environment Variables
    const secrets = {
      hasUrl: !!getEnv("SUPABASE_URL"),
      hasAnon: !!getEnv("SUPABASE_ANON_KEY"),
      hasStripeKey: !!getEnv("STRIPE_SECRET_KEY"),
      hasBasicPriceId: !!getEnv("STRIPE_BASIC_PRICE_ID"),
      hasProPriceId: !!getEnv("STRIPE_PRO_PRICE_ID"),
      hasSiteUrl: !!getEnv("SITE_URL"),
    };
    console.log('[Stripe Checkout] 🔐 Secrets presence:', JSON.stringify(secrets));

    if (!getEnv("SITE_URL")) {
      console.error('[Stripe Checkout] ❌ Missing SITE_URL');
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Configuration Error: SITE_URL is missing",
        responseHeaders,
        { missing: "SITE_URL" }
      );
    }
    if (!getEnv("STRIPE_SECRET_KEY")) {
      console.error('[Stripe Checkout] ❌ Missing STRIPE_SECRET_KEY');
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Configuration Error: STRIPE_SECRET_KEY is missing",
        responseHeaders,
        { missing: "STRIPE_SECRET_KEY" }
      );
    }
    if (!stripeClient) {
      console.error('[Stripe Checkout] ❌ Stripe client failed to initialize');
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Configuration Error: Stripe client is unavailable",
        responseHeaders,
        { missing: "STRIPE_SECRET_KEY" }
      );
    }

    // 2. Verify Auth Header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      console.error('[Stripe Checkout] ❌ Missing Authorization header');
      return createErrorResponse(
        ErrorCodes.AUTH_MISSING_HEADER,
        "Missing authorization header",
        responseHeaders
      );
    }

    const supabase = createSupabaseClient(authHeader)

    // 3. User Authentication
    console.log('[Stripe Checkout] 👤 Authenticating user...');

    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError) {
      console.error('[Stripe Checkout] ❌ Auth Error:', userError);
      return createErrorResponse(
        ErrorCodes.AUTH_INVALID_TOKEN,
        `User auth failed: ${userError.message}`,
        responseHeaders
      );
    }
    if (!user) {
      console.error('[Stripe Checkout] ❌ No user returned');
      return createErrorResponse(
        ErrorCodes.AUTH_USER_NOT_FOUND,
        "User not authenticated (no user found)",
        responseHeaders
      );
    }
    console.log(`[Stripe Checkout] ✅ User authenticated: ${user.id} (${user.email || 'no-email'})`);

    const requestBody = await req.json().catch(() => ({})) as {
      plan?: unknown;
      conversionSource?: unknown;
      utm?: {
        source?: unknown;
        medium?: unknown;
        campaign?: unknown;
      };
    };
    const plan = normalizePlan(requestBody.plan);
    if (!plan) {
      return createErrorResponse(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        "Invalid checkout plan",
        responseHeaders,
        { allowed: ["pro"] }
      );
    }
    if (plan === "basic") {
      return createErrorResponse(
        ErrorCodes.PAID_BASIC_FUTURE,
        "Paid Basic is not available yet. Start Free or upgrade to Pro.",
        responseHeaders,
        { allowed: ["pro"], unavailable: "basic" }
      );
    }
    const conversionSource = sanitizeMetadataValue(requestBody.conversionSource, 'unknown');
    const utmSource = sanitizeMetadataValue(requestBody.utm?.source, 'unknown');
    const utmMedium = sanitizeMetadataValue(requestBody.utm?.medium, conversionSource);
    const utmCampaign = sanitizeMetadataValue(requestBody.utm?.campaign, 'upgrade');

    // 4. Price Config - fail fast instead of attempting a mock Stripe price.
    const priceEnvName = "STRIPE_PRO_PRICE_ID";
    const priceId = getEnv(priceEnvName)?.trim();
    if (!priceId) {
      console.error(`[Stripe Checkout] ❌ Missing ${priceEnvName}`);
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        `Configuration Error: ${priceEnvName} is missing`,
        responseHeaders,
        { missing: priceEnvName }
      );
    }

    // 5. Determine return URL base (Strictly from Secrets)
    const siteUrl = getEnv("SITE_URL");
    const isLocalDev = !siteUrl || siteUrl.includes('localhost');

    if (!siteUrl && !isLocalDev) {
      console.error('[Stripe Checkout] ❌ SITE_URL missing in production');
      // ... fall back to localhost for dev, but this is caught by preflight usually
    }

    const effectiveSiteUrl = siteUrl ?? `http://localhost:${DEV_PORT}`;
    console.log(`[Stripe Checkout] 🔐 Using SITE_URL: ${effectiveSiteUrl}`);

    let stripeCustomerId: string | null = null;
    try {
      stripeCustomerId = await fetchExistingStripeCustomerId(supabase, user.id);
      if (stripeCustomerId) {
        console.log(`[Stripe Checkout] ✅ Reusing Stripe customer for user ${user.id}`);
      }
    } catch (profileError) {
      console.error("[Stripe Checkout] ❌ Failed to load billing customer profile:", profileError);
      return createErrorResponse(
        ErrorCodes.DATABASE_ERROR,
        "Unable to start checkout. Please try again or contact support.",
        responseHeaders
      );
    }

    const customerParams = stripeCustomerId
      ? { customer: stripeCustomerId }
      : user.email
        ? { customer_email: user.email }
        : {};

    // 5. Stripe Session Creation
    console.log(`[Stripe Checkout] 💳 Creating Stripe Session for ${plan} with Price ID: ${priceId}`);
    try {
      const session = await stripeClient.checkout.sessions.create({
        ...customerParams,
        payment_method_types: ["card"],
        client_reference_id: user.id,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${effectiveSiteUrl}/session?checkout=success&conversion_source=${encodeURIComponent(conversionSource)}&utm_source=${encodeURIComponent(utmSource)}&utm_medium=${encodeURIComponent(utmMedium)}&utm_campaign=${encodeURIComponent(utmCampaign)}`,
        cancel_url: `${effectiveSiteUrl}/pricing?checkout=cancelled&conversion_source=${encodeURIComponent(conversionSource)}&utm_source=${encodeURIComponent(utmSource)}&utm_medium=${encodeURIComponent(utmMedium)}&utm_campaign=${encodeURIComponent(utmCampaign)}`,
        metadata: {
          userId: user.id,
          plan,
          conversionSource,
          utmSource,
          utmMedium,
          utmCampaign,
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            plan,
            conversionSource,
            utmSource,
            utmMedium,
            utmCampaign,
          },
        },
      })
      console.log(`[Stripe Checkout] ✅ Session created: ${session.id}`)

      return createSuccessResponse({ checkoutUrl: session.url }, responseHeaders);
    } catch (stripeError) {
      console.error('[Stripe Checkout] ❌ Stripe API Error:', stripeError);
      const err = stripeError as { type?: string; code?: string; param?: string; message?: string };
      if (err.type) console.error('Error Type:', err.type);
      if (err.code) console.error('Error Code:', err.code);
      if (err.param) console.error('Error Param:', err.param);

      return createErrorResponse(
        ErrorCodes.STRIPE_API_ERROR,
        "Unable to start checkout. Please try again or contact support.",
        responseHeaders,
        { type: err.type, code: err.code, param: err.param }
      );
    }

  } catch (err) {
    const error = err as Error;
    console.error("[Stripe Checkout] 🚨 Fatal Error:", error.message);
    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      "Unable to start checkout. Please try again or contact support.",
      responseHeaders
    );
  }
}

if (import.meta.main) {
  serve((req) => handler(req));
}
