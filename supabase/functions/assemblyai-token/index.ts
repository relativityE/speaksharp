import { createClient } from "npm:@supabase/supabase-js";
import { AssemblyAI } from "npm:assemblyai";
import { corsHeaders } from "../_shared/cors.ts";

export async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders(),
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      req.headers.get("authorization")?.replace("Bearer ", "") ?? ""
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    console.log("Authenticated user:", user.id);

    // === 1. Try SDK method first ===
    try {
      const client = new AssemblyAI({ apiKey: Deno.env.get("ASSEMBLYAI_API_KEY")! });
      const tempToken = await client.realtime.createTemporaryToken({ expires_in: 600 });
      return new Response(JSON.stringify(tempToken), {
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    } catch (sdkError) {
      console.error("AssemblyAI SDK error:", sdkError);
      console.log("Falling back to raw fetch...");
    }

    // === 2. Fallback: Direct fetch to AssemblyAI ===
    const resp = await fetch("https://api.assemblyai.com/v2/realtime/token", {
      method: "POST",
      headers: {
        "authorization": Deno.env.get("ASSEMBLYAI_API_KEY")!,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expires_in: 600 }),
    });

    const data = await resp.json();
    console.log("AssemblyAI raw response:", data);

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
