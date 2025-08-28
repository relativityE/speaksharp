import { corsHeaders } from "../_shared/cors.ts";

// Modern Deno.serve pattern - this is what Supabase runtime expects
Deno.serve(async (req: Request): Promise<Response> => {
  // This log WILL appear now!
  console.log("🚀 assemblyai-token function invoked!");
  console.log(`Method: ${req.method}, URL: ${req.url}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log("CORS preflight request received. Responding with OK.");
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
  }

  try {
    console.log("Checking for ASSEMBLYAI_API_KEY...");

    // Get your AssemblyAI API key from environment
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!assemblyAIKey) {
      console.error('❌ ASSEMBLYAI_API_KEY environment variable not set');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    console.log("✅ ASSEMBLYAI_API_KEY found, generating token...");

    // Generate AssemblyAI token
    const assemblyResponse = await fetch('https://api.assemblyai.com/v2/realtime/token', {
      method: 'POST',
      headers: {
        'Authorization': assemblyAIKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expires_in: 3600, // Token valid for 1 hour
        model: 'universal' // Specify the model to use
      })
    });

    if (!assemblyResponse.ok) {
      const errorText = await assemblyResponse.text();
      console.error('❌ AssemblyAI token generation failed:', errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to generate AssemblyAI token',
          details: `AssemblyAI API returned ${assemblyResponse.status}`
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        }
      );
    }

    const assemblyData = await assemblyResponse.json();
    console.log("🎟️ Successfully generated AssemblyAI token");

    return new Response(
      JSON.stringify({
        token: assemblyData.token,
        expires_in: assemblyData.expires_in || 3600
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    console.error('💥 Unexpected error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      }
    );
  }
});
