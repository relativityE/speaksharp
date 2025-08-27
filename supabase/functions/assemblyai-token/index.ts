import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';
import { corsHeaders } from '../_shared/cors.ts';

// This function creates a temporary token for the client to use to connect
// to the AssemblyAI streaming service.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Create a Supabase client with the user's auth context
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders });
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // 2. Verify the user is authenticated
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not authenticated' }), { status: 401, headers: corsHeaders });
    }

    // 3. Securely retrieve the AssemblyAI API key from environment variables
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!assemblyAIKey) {
      throw new Error("ASSEMBLYAI_API_KEY is not configured on the server.");
    }

    // 4. Create an AssemblyAI client and generate a temporary token for the new model
    const assemblyai = new AssemblyAI({ apiKey: assemblyAIKey });
    const tempToken = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });

    // 5. Return the temporary token to the client
    return new Response(JSON.stringify({ token: tempToken }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in assemblyai-token handler:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
