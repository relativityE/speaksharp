import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { PORTS } from "../_shared/build.config.js";

// Defensive Stripe initialization - validate env before crash
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY) {
  console.error("FATAL: STRIPE_SECRET_KEY environment variable is not set.");
}

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
  : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // DIAGNOSTIC LOGGING
    console.log('[Stripe Checkout] 🔍 Starting request processing');

    // 1. Verify Environment Variables
    const secrets = {
      hasUrl: !!Deno.env.get("SUPABASE_URL"),
      hasAnon: !!Deno.env.get("SUPABASE_ANON_KEY"),
      hasStripeKey: !!Deno.env.get("STRIPE_SECRET_KEY"),
      hasPriceId: !!Deno.env.get("STRIPE_PRO_PRICE_ID"),
      hasSiteUrl: !!Deno.env.get("SITE_URL"),
    };
    console.log('[Stripe Checkout] 🔐 Secrets presence:', JSON.stringify(secrets));

    if (!Deno.env.get("SITE_URL")) {
      console.error('[Stripe Checkout] ❌ Missing SITE_URL');
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Configuration Error: SITE_URL is missing",
        corsHeaders,
        { missing: "SITE_URL" }
      );
    }
    if (!Deno.env.get("STRIPE_SECRET_KEY")) {
      console.error('[Stripe Checkout] ❌ Missing STRIPE_SECRET_KEY');
      return createErrorResponse(
        ErrorCodes.CONFIG_MISSING_ENV,
        "Configuration Error: STRIPE_SECRET_KEY is missing",
        corsHeaders,
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
        corsHeaders
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // 3. User Authentication
    console.log('[Stripe Checkout] 👤 Authenticating user...');
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError) {
      console.error('[Stripe Checkout] ❌ Auth Error:', userError);
      return createErrorResponse(
        ErrorCodes.AUTH_INVALID_TOKEN,
        `User auth failed: ${userError.message}`,
        corsHeaders
      );
    }
    if (!user) {
      console.error('[Stripe Checkout] ❌ No user returned');
      return createErrorResponse(
        ErrorCodes.AUTH_USER_NOT_FOUND,
        "User not authenticated (no user found)",
        corsHeaders
      );
    }
    console.log(`[Stripe Checkout] ✅ User authenticated: ${user.id} (${user.email || 'no-email'})`);

    // 4. Price Config - Use fallback for local dev (prod uses Supabase Secrets)
    const priceId = Deno.env.get("STRIPE_PRO_PRICE_ID") ?? "price_mock_default";
    const isUsingMock = priceId === "price_mock_default";
    if (isUsingMock) {
      console.warn("[Stripe Checkout] ⚠️ Using mock price ID - set STRIPE_PRO_PRICE_ID for real checkout");
    }

    // 5. Stripe Session Creation
    console.log(`[Stripe Checkout] 💳 Creating Stripe Session with Price ID: ${priceId}`);
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${Deno.env.get("SITE_URL") ?? `http://localhost:${PORTS.DEV}`}/session?checkout=success`,
        cancel_url: `${Deno.env.get("SITE_URL") ?? `http://localhost:${PORTS.DEV}`}/pricing?checkout=cancelled`,
        customer_email: user.email,
        metadata: {
          userId: user.id,
        },
        subscription_data: {
          metadata: {
            userId: user.id,
          },
        },
      })
      console.log(`[Stripe Checkout] ✅ Session created: ${session.id}`)

      return createSuccessResponse({ checkoutUrl: session.url }, corsHeaders);
    } catch (stripeError) {
      console.error('[Stripe Checkout] ❌ Stripe API Error:', stripeError);
      const err = stripeError as { type?: string; code?: string; param?: string; message?: string };
      if (err.type) console.error('Error Type:', err.type);
      if (err.code) console.error('Error Code:', err.code);
      if (err.param) console.error('Error Param:', err.param);

      return createErrorResponse(
        ErrorCodes.STRIPE_API_ERROR,
        err.message || "Stripe API error",
        corsHeaders,
        { type: err.type, code: err.code, param: err.param }
      );
    }

  } catch (err) {
    const error = err as Error;
    console.error("[Stripe Checkout] 🚨 Fatal Error:", error.message);
    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      error.message || "An unexpected error occurred",
      corsHeaders
    );
  }
})
