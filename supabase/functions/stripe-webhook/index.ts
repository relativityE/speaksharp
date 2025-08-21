import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@16.2.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.2"

// Initialize Stripe and Supabase clients.
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") as string, {
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: "2024-06-20",
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

// Helper function to update user's subscription status based on Stripe customer ID.
const handleSubscriptionChange = async (subscription, status) => {
  const customerId = subscription.customer
  if (!customerId) {
    throw new Error("Customer ID is missing in the subscription event.")
  }

  // Find the user with this customer ID and update their status.
  const { error } = await supabase
    .from("user_profiles")
    .update({ subscription_status: status })
    .eq("stripe_customer_id", customerId)

  if (error) {
    console.error(`Error updating subscription status for customer ${customerId}:`, error)
    throw error
  }
  console.log(`Subscription status for customer ${customerId} updated to ${status}.`)
}

serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature")
  if (!signature) {
    return new Response("Stripe-Signature header is required.", { status: 400 })
  }
  const body = await req.text()

  try {
    const event = await stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    )

    // Use a switch statement to handle different event types.
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        const userId = session.client_reference_id

        if (!userId) {
          throw new Error("Critical: Missing client_reference_id on checkout session.")
        }

        // On successful payment, grant "Pro" access and store Stripe IDs.
        // Storing stripe_customer_id is crucial for managing the subscription later.
        const { error } = await supabase
          .from("user_profiles")
          .update({
            subscription_status: "pro",
            stripe_subscription_id: session.subscription,
            stripe_customer_id: session.customer,
          })
          .eq("id", userId)

        if (error) throw error
        console.log(`Successfully activated "pro" status for user ${userId}.`)
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object
        // The subscription object is available on the invoice.
        await handleSubscriptionChange({ customer: invoice.customer }, "past_due")
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object
        await handleSubscriptionChange(subscription, "canceled")
        break
      }

      default:
        // console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("Error processing webhook:", err.message)
    return new Response(err.message, { status: 400 })
  }
})
