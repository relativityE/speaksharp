import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  console.log("🚀 assemblyai-token function invoked!");
  console.log(`Method: ${req.method}, URL: ${req.url}`);

  if (req.method === 'OPTIONS') {
    console.log("CORS preflight request received. Responding with OK.");
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    console.log("Checking for ASSEMBLYAI_API_KEY...");
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!assemblyAIKey) {
      console.error('❌ ASSEMBLYAI_API_KEY environment variable not set');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }
    console.log("✅ ASSEMBLYAI_API_KEY found, generating token...");

    // Correct v3 token generation: GET request with query params, no body.
    const tokenUrl = new URL("https://streaming.assemblyai.com/v3/token");
    tokenUrl.searchParams.set("expires_in_seconds", "3600");

    const assemblyResponse = await fetch(tokenUrl, {
      method: 'GET', // v3 uses GET
      headers: { 'Authorization': assemblyAIKey }
    });

    if (!assemblyResponse.ok) {
      const errorText = await assemblyResponse.text();
      console.error('❌ AssemblyAI v3 token generation failed:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to generate AssemblyAI v3 token',
          details: `AssemblyAI API returned ${assemblyResponse.status}`
        }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
      );
    }

    const assemblyData = await assemblyResponse.json();
    console.log("🎟️ Successfully generated AssemblyAI v3 token");

    return new Response(
      JSON.stringify({ token: assemblyData.token }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );

  } catch (error) {
    console.error('💥 Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
});
