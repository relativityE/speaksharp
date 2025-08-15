import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// IMPORTANT: Supabase Edge Functions use Deno and import from URLs.
// We use esm.sh to get the assemblyai npm package.
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const client = new AssemblyAI({
  apiKey: Deno.env.get('ASSEMBLYAI_API_KEY'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    } });
  }

  try {
    const token = await client.realtime.createTemporaryToken({ expires_in: 3600 });
    return new Response(
      JSON.stringify({ token }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      }
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate token' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        },
      }
    );
  }
});
