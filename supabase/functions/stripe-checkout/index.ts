import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"

// Add CORS headers for browser-based requests.
const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('CORS_ALLOWED_ORIGIN') || 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Stripe client. It's essential to specify the API version.
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") as string, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
})

serve(async (req) => {
  // Handle CORS preflight request, which is required for browser security.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Authenticate the user by verifying their JWT.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized: User not authenticated" }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Validate the input from the client.
    const { priceId } = await req.json()
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Bad Request: priceId is required" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Validate the priceId against an allow-list stored in an environment variable.
    const validPriceIds = (Deno.env.get("STRIPE_VALID_PRICE_IDS") || '').split(',')
    if (!validPriceIds.includes(priceId)) {
        return new Response(JSON.stringify({ error: "Bad Request: Invalid priceId" }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. Create the Stripe checkout session, now with proper user association.
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${Deno.env.get("SITE_URL")}/`,
      cancel_url: `${Deno.env.get("SITE_URL")}/`,
      // Associate the checkout session with the authenticated user.
      // This is CRITICAL for the webhook to know which user to grant access to.
      customer_email: user.email,
      client_reference_id: user.id,
    })

    return new Response(JSON.stringify({ sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (error) {
    console.error("Error creating Stripe checkout session:", error)
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
