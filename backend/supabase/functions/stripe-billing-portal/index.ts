import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@16"
import { createClient } from "npm:@supabase/supabase-js@2"
import { ErrorCodes, createErrorResponse, createSuccessResponse } from "../_shared/errors.ts"
import { corsHeaders as buildCorsHeaders } from "../_shared/cors.ts"

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY && import.meta.main) {
  console.error("FATAL: STRIPE_SECRET_KEY environment variable is not set.");
}

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
  : null;

type EnvGetter = (key: string) => string | undefined;
type SupabaseFactory = (authHeader: string) => ReturnType<typeof createClient>;
type StripeLike = {
  billingPortal: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<{ url: string | null }>;
    };
  };
};

type HandlerDeps = {
  getEnv?: EnvGetter;
  createSupabase?: SupabaseFactory;
  stripeClient?: StripeLike | null;
};

const fetchStripeCustomerId = async (
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

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

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  if (req.method !== "POST") {
    return createErrorResponse(
      ErrorCodes.VALIDATION_INVALID_FORMAT,
      "Billing portal requires a POST request",
      responseHeaders
    );
  }

  if (!getEnv("SITE_URL")) {
    return createErrorResponse(
      ErrorCodes.CONFIG_MISSING_ENV,
      "Configuration Error: SITE_URL is missing",
      responseHeaders,
      { missing: "SITE_URL" }
    );
  }
  if (!getEnv("STRIPE_SECRET_KEY") || !stripeClient) {
    return createErrorResponse(
      ErrorCodes.CONFIG_MISSING_ENV,
      "Billing portal is not configured",
      responseHeaders,
      { missing: "STRIPE_SECRET_KEY" }
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return createErrorResponse(
      ErrorCodes.AUTH_MISSING_HEADER,
      "Missing authorization header",
      responseHeaders
    );
  }

  try {
    const supabase = createSupabaseClient(authHeader);
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError) {
      return createErrorResponse(
        ErrorCodes.AUTH_INVALID_TOKEN,
        `User auth failed: ${userError.message}`,
        responseHeaders
      );
    }
    if (!user) {
      return createErrorResponse(
        ErrorCodes.AUTH_USER_NOT_FOUND,
        "User not authenticated",
        responseHeaders
      );
    }

    const stripeCustomerId = await fetchStripeCustomerId(supabase, user.id);
    if (!stripeCustomerId) {
      return createErrorResponse(
        ErrorCodes.VALIDATION_MISSING_FIELD,
        "Billing management is not ready for this account yet. Please contact support.",
        responseHeaders,
        { missing: "stripe_customer_id" }
      );
    }

    const siteUrl = getEnv("SITE_URL")!;
    const session = await stripeClient.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${siteUrl}/pricing?billing=returned`,
    });

    if (!session.url) {
      return createErrorResponse(
        ErrorCodes.STRIPE_API_ERROR,
        "Unable to open billing management. Please contact support.",
        responseHeaders
      );
    }

    return createSuccessResponse({ portalUrl: session.url }, responseHeaders);
  } catch (err) {
    console.error("[Stripe Billing Portal] Error:", err);
    return createErrorResponse(
      ErrorCodes.INTERNAL_ERROR,
      "Unable to open billing management. Please contact support.",
      responseHeaders
    );
  }
}

if (import.meta.main) {
  serve((req) => handler(req));
}
