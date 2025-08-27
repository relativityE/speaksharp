import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

// This function creates a temporary token for the client to use to connect
// to the AssemblyAI streaming service.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Get the Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    const token = authHeader.replace('Bearer ', '');

    // 2. Get secrets from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');

    if (!supabaseUrl || !serviceRoleKey || !assemblyAIKey) {
      console.error('Missing environment variables');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 3. Authenticate the user using the Supabase Admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError) {
      console.error('Authentication error:', userError.message);
      return new Response(JSON.stringify({ error: 'Invalid token: ' + userError.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    // Optional: Check if the user is anonymous (for dev mode) or a real user
    // and apply different logic (e.g., check subscription for real users).
    // For now, we allow any authenticated user.
    console.log(`Successfully authenticated user: ${user.id}`);


    // 4. Create a temporary token for AssemblyAI
    const assemblyai = new AssemblyAI({ apiKey: assemblyAIKey });
    const tempToken = await assemblyai.realtime.createTemporaryToken({ expires_in: 3600 }); // Expires in 1 hour
    return new Response(JSON.stringify({ token: tempToken }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 200
    });

  } catch (err) {
    console.error("Critical error in assemblyai-token handler:", err);
    const message = (err instanceof Error) ? err.message : 'An unexpected error occurred.';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 500
    });
  }
});
