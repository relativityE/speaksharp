import { createClient } from "npm:@supabase/supabase-js";
import { AssemblyAI } from "npm:assemblyai";
import { corsHeaders } from "../_shared/cors.ts";

export async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  try {
    console.log("assemblyai-token function invoked.");

    // --- 1. Simple dev auth check ---
    const apiKeyHeader = req.headers.get("apikey");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!apiKeyHeader || apiKeyHeader !== supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — missing or invalid apikey header" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    // --- 2. Request AssemblyAI token ---
    const assemblyKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) throw new Error("ASSEMBLYAI_API_KEY not set");

    try {
      // Use SDK
      const client = new AssemblyAI({ apiKey: assemblyKey });
      const tempToken = await client.realtime.createTemporaryToken({ expires_in: 600 });
      return new Response(JSON.stringify(tempToken), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    } catch (sdkError) {
      console.warn("SDK failed, falling back to fetch:", sdkError);
    }

    // Fallback: raw fetch
    const resp = await fetch("https://api.assemblyai.com/v2/realtime/token", {
      method: "POST",
      headers: {
        "authorization": assemblyKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expires_in: 600 }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: "AssemblyAI token request failed", details: data }),
        { status: resp.status, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    console.error("Unexpected error in assemblyai-token function:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
}
