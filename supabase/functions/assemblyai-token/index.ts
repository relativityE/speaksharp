// supabase/functions/assemblyai-token/index.ts
import { corsHeaders } from "../_shared/cors.ts";
import AssemblyAI from "npm:assemblyai";

Deno.serve(async (req) => {
  // 1. Handle OPTIONS early
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders() });
  }

  try {
    // 2. Init AssemblyAI client
    const assemblyai = new AssemblyAI({
      apiKey: Deno.env.get("ASSEMBLYAI_API_KEY")!,
    });

    // 3. Request temp token
    const tempToken = await assemblyai.realtime.createTemporaryToken({
      expires_in: 600,
    });

    // 4. Return with CORS
    return new Response(JSON.stringify(tempToken), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  } catch (err) {
    // 5. Ensure errors ALSO include CORS
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }
});
