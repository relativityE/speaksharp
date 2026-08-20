/**
 * AssemblyAI Token Generator - Supabase Edge Function
 *
 * Note: This runs in Deno runtime, not Node.js. IDE warnings about "Cannot find
 * name 'Deno'" or ESM imports are expected - the code works correctly when deployed.
 */
import { corsGuard, corsHeaders } from "../_shared/cors.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type SupabaseClientFactory = (authHeader: string) => SupabaseClient;
type Fetcher = typeof fetch;

export async function handler(
  req: Request,
  createSupabase: SupabaseClientFactory,
  fetchImpl: Fetcher = fetch,
) {
  // Exact-origin CORS guard: reject hostile/unapproved origins and answer preflight BEFORE any
  // env read, JWT auth, Supabase access, or AssemblyAI provider/token call.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

  try {
    // Retain the injectable argument temporarily for old test/caller compatibility, but never call the
    // external provider. Customer recordings are Private-only for active-trial and paid accounts alike.
    void fetchImpl;

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

    console.warn(`🚫 Retired provider-token endpoint requested by user ${user.id}`);
    return new Response(
      JSON.stringify({
        error: "This endpoint is unavailable; recordings use on-device Private transcription.",
      }),
      {
        status: 410,
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
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

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
