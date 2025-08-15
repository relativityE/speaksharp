import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// IMPORTANT: Supabase Edge Functions use Deno and import from URLs.
// We use esm.sh to get the assemblyai npm package.
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const client = new AssemblyAI({
  apiKey: Deno.env.get('ASSEMBLYAI_API_KEY'),
});

// Determine the allowed origin based on the environment.
// For local development, allow localhost. For production, use the specific domain.
const allowedOrigin = Deno.env.get('DENO_ENV') === 'development'
  ? 'http://localhost:5173'
  : 'https://speaksharp.com'; // Replace with your actual production domain

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Generate a temporary token for the client to use.
    const token = await client.realtime.createTemporaryToken({ expires_in: 3600 });
    return new Response(
      JSON.stringify({ token }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating AssemblyAI token:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate token' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
