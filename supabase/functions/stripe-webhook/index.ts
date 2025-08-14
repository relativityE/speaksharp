import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
)

serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature")
  const body = await req.text()

  try {
    const event = await stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")
    )

    if (event.type === "checkout.session.completed") {
      const session = event.data.object
      const { userId, subscriptionId } = session.metadata

      await supabase
        .from("user_profiles")
        .update({
          subscription_status: "pro",
          stripe_subscription_id: subscriptionId,
        })
        .eq("id", userId)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(err.message, { status: 400 })
  }
})
