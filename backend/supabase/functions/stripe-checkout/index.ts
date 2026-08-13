import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@16"
import { createClient } from "npm:@supabase/supabase-js@2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { corsGuard, corsHeaders as buildCorsHeaders } from "../_shared/cors.ts"

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
type StripePrice = {
  active?: boolean;
  unit_amount?: number | null;
  currency?: string;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
};
type StripeLike = {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{ id: string; url: string | null }>;
    };
  };
  prices: {
    retrieve: (id: string) => Promise<StripePrice>;
  };
};

// #1266/#1282 — the Pro price is the server-configured recurring monthly price of EXACTLY 1,000 cents.
// The amount is never caller-supplied: checkout uses STRIPE_PRO_PRICE_ID and, before creating a session,
// verifies that the resolved Stripe Price is active, recurring monthly, exactly 1000 cents, in the
// configured currency. A misconfigured price fails closed (no checkout is created at the wrong price).
const PRO_PRICE_EXPECTED_UNIT_AMOUNT = 1000;

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
  // Exact-origin CORS guard: reject hostile/unapproved origins and answer preflight BEFORE any
  // env read, payments-enabled check, auth, Supabase, or Stripe API/session-creation call.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

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

  // (CORS preflight + hostile-origin rejection handled by corsGuard above.)

  // Fail-closed beta billing (authoritative server guard — frontend hiding is not sufficient).
  // Checkout is refused unless BOTH: payments are explicitly enabled AND a LIVE Stripe secret key is
  // configured. Defaults to closed, so a stray live publishable key alone can never open checkout.
  // This does NOT touch existing entitlements: it only refuses to CREATE new checkout sessions.
  {
    const paymentsExplicitlyEnabled = getEnv("PAYMENTS_ENABLED") === "true";
    const secretKey = getEnv("STRIPE_SECRET_KEY");
    const hasLiveSecret = typeof secretKey === "string" && secretKey.startsWith("sk_live_");
    if (!paymentsExplicitlyEnabled || !hasLiveSecret) {
      console.warn("[Stripe Checkout] ⛔ payments disabled — refusing checkout (fail-closed beta)");
      return createErrorResponse(
        ErrorCodes.PAYMENTS_DISABLED,
        "Pro enrollment is not open during this beta.",
        responseHeaders,
        { paymentsEnabled: false },
      );
    }
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

    // 4b. Verify the configured Pro price BEFORE creating a session. The amount is server-owned, never
    // caller-supplied; we additionally assert it is an active, recurring MONTHLY price of EXACTLY 1,000
    // cents in the configured currency (#1266/#1282 contract). Any mismatch fails closed — we never open
    // checkout at an unverified or wrong price.
    {
      const expectedCurrency = (getEnv("STRIPE_PRICE_CURRENCY") ?? "usd").trim().toLowerCase();
      let price: StripePrice;
      try {
        price = await stripeClient.prices.retrieve(priceId);
      } catch (priceErr) {
        console.error("[Stripe Checkout] ❌ Failed to retrieve Pro price for verification:", priceErr);
        return createErrorResponse(
          ErrorCodes.CONFIG_INVALID_PRICE,
          "Unable to verify the Pro price configuration. Checkout is unavailable.",
          responseHeaders,
          { priceEnv: priceEnvName },
        );
      }

      const actualCurrency = (price?.currency ?? "").toLowerCase();
      const interval = price?.recurring?.interval ?? null;
      const intervalCount = price?.recurring?.interval_count ?? null;
      // #1282 blocker 2: FAIL CLOSED. active MUST be exactly true (a missing/undefined active field is NOT
      // treated as active); the price MUST recur every 1 month (interval 'month' AND interval_count === 1,
      // so a 3-month or annual price cannot masquerade as "monthly"); exactly 1000 cents; configured currency.
      const problems: string[] = [];
      if (price?.active !== true) problems.push(`active:${price?.active ?? "missing"}`);
      if (interval !== "month") problems.push(`interval:${interval ?? "none"}`);
      if (intervalCount !== 1) problems.push(`interval_count:${intervalCount ?? "none"}`);
      if (price?.unit_amount !== PRO_PRICE_EXPECTED_UNIT_AMOUNT) problems.push(`unit_amount:${price?.unit_amount ?? "none"}`);
      if (actualCurrency !== expectedCurrency) problems.push(`currency:${actualCurrency || "none"}`);

      if (problems.length > 0) {
        console.error(`[Stripe Checkout] ❌ Pro price failed verification (${problems.join(", ")})`);
        return createErrorResponse(
          ErrorCodes.CONFIG_INVALID_PRICE,
          `The configured Pro price must be an active recurring monthly price of exactly ${PRO_PRICE_EXPECTED_UNIT_AMOUNT} ${expectedCurrency}.`,
          responseHeaders,
          { problems, expectedUnitAmount: PRO_PRICE_EXPECTED_UNIT_AMOUNT, expectedCurrency },
        );
      }
    }

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
