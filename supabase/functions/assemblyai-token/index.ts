import { corsHeaders } from "../_shared/cors.ts";

const ASSEMBLYAI_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");

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
    console.log("✅ ASSEMBLYAI_API_KEY found, generating token...");

    // Correct v3 token generation: GET request to the streaming-specific endpoint.
    const expiresIn = 600; // max 600 seconds
    const tokenUrl = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${expiresIn}`;

    const resp = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ASSEMBLYAI_KEY}`,
      },
    });

    if (!resp.ok) {
      const errData = await resp.json();
      console.error("AssemblyAI v3 token request failed:", errData);
      return new Response(JSON.stringify({ error: "Failed to generate AssemblyAI token", details: errData }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const data = await resp.json();

    return new Response(JSON.stringify({ token: data.token, expires_in: data.expires_in_seconds }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });

  } catch (err) {
    console.error("Unexpected error in assemblyai-token function:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }
});
