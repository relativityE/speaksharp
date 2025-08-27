import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';
import { corsHeaders } from '../_shared/cors.ts';

const assemblyAIKey = Deno.env.get('ASSEMBLYAI_API_KEY');
if (!assemblyAIKey) {
  // This is a critical error, so we throw an exception.
  throw new Error("ASSEMBLYAI_API_KEY is not set in environment variables.");
}

// Initialize AssemblyAI client
const assemblyai = new AssemblyAI({
  apiKey: assemblyAIKey,
});

Deno.serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the Auth context of the logged-in user.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Get the user from the session.
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError) throw userError;
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'User not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For a real app, you might want to check for a specific subscription status
    // before granting access to a paid feature.
    //
    // const { data: profile, error: profileError } = await supabaseClient
    //   .from('profiles')
    //   .select('subscription_status')
    //   .eq('id', user.id)
    //   .single();
    //
    // if (profileError || !profile) {
    //   return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 500, headers: corsHeaders });
    // }
    // if (profile.subscription_status !== 'active' && !user.is_anonymous) {
    //   return new Response(JSON.stringify({ error: 'User does not have an active subscription' }), { status: 403, headers: corsHeaders });
    // }

    // Generate a temporary token for the client to use.
    // The token is valid for 10 minutes.
    const tempToken = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });

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
