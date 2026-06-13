/**
 * AssemblyAI Token Generator - Supabase Edge Function
 *
 * Note: This runs in Deno runtime, not Node.js. IDE warnings about "Cannot find
 * name 'Deno'" or ESM imports are expected - the code works correctly when deployed.
 */
import { corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type SupabaseClientFactory = (authHeader: string) => SupabaseClient;
type EnvGetter = (key: string) => string | undefined;
type Fetcher = typeof fetch;

type UserProfile = {
  subscription_status?: string | null;
  trial_expires_at?: string | null;
  stripe_subscription_id?: string | null;
  subscription_id?: string | null;
};

function hasCloudProFeatureEntitlement(profile: UserProfile | null): boolean {
  if (profile?.subscription_status !== "pro") return false;
  return Boolean(
    profile.stripe_subscription_id?.trim() || profile.subscription_id?.trim(),
  );
}

export async function handler(
  req: Request,
  createSupabase: SupabaseClientFactory,
  fetchImpl: Fetcher = fetch,
  getEnv: EnvGetter = (key) => Deno.env.get(key) ?? undefined,
) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  try {
    const ASSEMBLYAI_KEY = getEnv("ASSEMBLYAI_API_KEY");
    if (!ASSEMBLYAI_KEY) {
      throw new Error("Missing ASSEMBLYAI_API_KEY environment variable.");
    }

    // 1. Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn("🚫 Token request rejected: Missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    const supabase = createSupabase(authHeader);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn(
        "🚫 Token request rejected: Invalid or expired token",
        authError?.message,
      );
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    // 2. Verify effective Pro entitlement through the DB-side source of truth.
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select(
        "subscription_status,trial_expires_at,stripe_subscription_id,subscription_id",
      )
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("🚫 Failed to fetch user profile:", profileError.message);
      return new Response(
        JSON.stringify({ error: "Failed to verify subscription" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    const userProfile = profile as UserProfile | null;

    // 3. Verify usage eligibility before issuing a Cloud STT token.
    const { data: usageLimit, error: usageError } = await supabase.rpc(
      "check_usage_limit",
    );
    if (usageError) {
      console.error(
        "🚫 Failed to verify usage limit before AssemblyAI token issuance:",
        usageError.message,
      );
      return new Response(
        JSON.stringify({ error: "Unable to verify usage limit" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    if (!hasCloudProFeatureEntitlement(userProfile)) {
      console.warn(
        `🚫 Token request rejected: User ${user.id} does not have Cloud STT Pro feature entitlement (stored: ${userProfile?.subscription_status ?? "unknown"}, trial_expires_at: ${userProfile?.trial_expires_at ?? "none"})`,
      );
      return new Response(
        JSON.stringify({
          error: "Cloud STT is a paid Early Access feature. Browser transcription is still available.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    if (usageLimit && usageLimit.can_start === false) {
      console.warn(
        `🚫 Token request rejected: User ${user.id} cannot start a Cloud session`,
      );
      return new Response(
        JSON.stringify({ error: usageLimit.error ?? "Usage limit reached" }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    // 4. Generate token (user is authenticated, Pro, and usage-eligible)
    console.log(`✅ Generating AssemblyAI token for Pro user: ${user.id}`);

    const expiresIn = 600; // max 600 seconds
    const tokenUrl =
      `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expiresIn}`;

    const resp = await fetchImpl(tokenUrl, {
      method: "GET",
      headers: {
        "Authorization": ASSEMBLYAI_KEY,
      },
    });

    if (!resp.ok) {
      const errData = await resp.json();
      console.error("AssemblyAI v3 token request failed:", errData);
      return new Response(
        JSON.stringify({
          error: "Failed to generate AssemblyAI token",
        }),
        {
          status: resp.status,
          headers: { "Content-Type": "application/json", ...corsHeaders(req) },
        },
      );
    }

    const data = await resp.json();

    console.log(
      `✅ Successfully generated AssemblyAI token for user ${user.id}, expires in ${data.expires_in_seconds}s`,
    );

    return new Response(
      JSON.stringify({
        token: data.token,
        expires_in: data.expires_in_seconds,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      },
    );
  } catch (err) {
    console.error("Unexpected error in assemblyai-token function:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }
}

if (import.meta.main) {
  const ASSEMBLYAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

  if (!ASSEMBLYAI_KEY) {
    console.error("Missing ASSEMBLYAI_API_KEY environment variable.");
  }

  Deno.serve((req: Request) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }

    return handler(
      req,
      (authHeader) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        }),
    );
  });
}
