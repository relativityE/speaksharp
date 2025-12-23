/**
 * AssemblyAI Token Generator - Supabase Edge Function
 *
 * Note: This runs in Deno runtime, not Node.js. IDE warnings about "Cannot find
 * name 'Deno'" or ESM imports are expected - the code works correctly when deployed.
 */
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ASSEMBLYAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!ASSEMBLYAI_KEY) {
  console.error("Missing ASSEMBLYAI_API_KEY environment variable.");
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (!ASSEMBLYAI_KEY) {
      throw new Error("Missing ASSEMBLYAI_API_KEY environment variable.");
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Missing Supabase environment variables.");
    }

    // 1. Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn("🚫 Token request rejected: Missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.warn("🚫 Token request rejected: Invalid or expired token", authError?.message);
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // 2. Verify Pro subscription
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("🚫 Failed to fetch user profile:", profileError.message);
      return new Response(JSON.stringify({ error: "Failed to verify subscription" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    if (profile?.subscription_status !== "pro") {
      console.warn(`🚫 Token request rejected: User ${user.id} is not Pro (status: ${profile?.subscription_status})`);
      return new Response(JSON.stringify({ error: "Pro subscription required for AssemblyAI features" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // 3. Generate token (user is authenticated and has Pro subscription)
    console.log(`✅ Generating AssemblyAI token for Pro user: ${user.id}`);

    const expiresIn = 600; // max 600 seconds
    const tokenUrl = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expiresIn}`;

    const resp = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        "Authorization": ASSEMBLYAI_KEY,
      },
    });

    if (!resp.ok) {
      const errData = await resp.json();
      console.error("AssemblyAI v3 token request failed:", errData);
      return new Response(JSON.stringify({ error: "Failed to generate AssemblyAI token", details: errData }), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const data = await resp.json();

    console.log(`✅ Successfully generated AssemblyAI token for user ${user.id}, expires in ${data.expires_in_seconds}s`);

    return new Response(JSON.stringify({ token: data.token, expires_in: data.expires_in_seconds }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });

  } catch (err) {
    console.error("Unexpected error in assemblyai-token function:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});
