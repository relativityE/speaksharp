import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  // This is needed to use the Fetch API instead of Node's HTTP module.
  httpClient: Stripe.createFetchHttpClient(),
})

serve(async (req) => {
  const { priceId } = await req.json()

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
      success_url: `${Deno.env.get("SITE_URL")}/`,
      cancel_url: `${Deno.env.get("SITE_URL")}/`,
    })

    return new Response(JSON.stringify({ sessionId: session.id }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
})
