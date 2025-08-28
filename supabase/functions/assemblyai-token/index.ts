import { AssemblyAI } from "https://esm.sh/assemblyai@4.15.0";
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
    console.log("Checking for ASSEMBLYAI_API_KEY...");
    const assemblyKey = Deno.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      console.error("ASSEMBLYAI_API_KEY not found in environment variables.");
      throw new Error("ASSEMBLYAI_API_KEY not set");
    }
    console.log("ASSEMBLYAI_API_KEY found.");

    try {
      // Use SDK
      console.log("Attempting to get token via AssemblyAI SDK...");
      const client = new AssemblyAI({ apiKey: assemblyKey });
      const tempToken = await client.realtime.createTemporaryToken({ expires_in: 600 });
      console.log("Successfully retrieved token via SDK.");
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
