import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
})

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
      throw new Error("Configuration Error: SITE_URL is missing (expected in CI until secrets are provisioned)");
    }
    if (!Deno.env.get("STRIPE_SECRET_KEY")) {
      console.error('[Stripe Checkout] ❌ Missing STRIPE_SECRET_KEY');
      throw new Error("Configuration Error: STRIPE_SECRET_KEY is missing");
    }

    // 2. Verify Auth Header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      console.error('[Stripe Checkout] ❌ Missing Authorization header');
      throw new Error("Missing authorization header")
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
      throw new Error(`User auth failed: ${userError.message}`);
    }
    if (!user) {
      console.error('[Stripe Checkout] ❌ No user returned');
      throw new Error("User not authenticated (no user found)");
    }
    console.log(`[Stripe Checkout] ✅ User authenticated: ${user.id} (${user.email || 'no-email'})`);

    // 4. Price Config
    const priceId = Deno.env.get("STRIPE_PRO_PRICE_ID")
    if (!priceId) {
      throw new Error("STRIPE_PRO_PRICE_ID not configured")
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
        success_url: `${Deno.env.get("SITE_URL")}/session?checkout=success`,
        cancel_url: `${Deno.env.get("SITE_URL")}/pricing?checkout=cancelled`,
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

      return new Response(
        JSON.stringify({ checkoutUrl: session.url }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    } catch (stripeError) {
      console.error('[Stripe Checkout] ❌ Stripe API Error:', stripeError);
      // Log detailed Stripe error if available
      const err = stripeError as any;
      if (err.type) console.error('Error Type:', err.type);
      if (err.code) console.error('Error Code:', err.code);
      if (err.param) console.error('Error Param:', err.param);
      throw stripeError; // Re-throw to outer catch
    }

  } catch (err) {
    const error = err as any;
    console.error("[Stripe Checkout] 🚨 Fatal Error:", error.message);
    // Return detailed JSON error for client debugging
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack, // Optional: remove in prod if sensitive
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
