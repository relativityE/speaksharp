import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Define the handler with dependency injection for testability
export async function handler(req, createSupabase, createAssemblyAI) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Universal developer mode bypass
    if (Deno.env.get("SUPER_DEV_MODE") === 'true') {
      console.log('[assemblyai-token] SUPER_DEV_MODE enabled. Bypassing user auth and usage limits.');
      const assemblyai = createAssemblyAI();
      const token = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });
      return new Response(JSON.stringify({ token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Production Mode: Standard user authentication and "pro" plan check.
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createSupabase(authHeader);
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed - v2' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('subscription_status, usage_seconds')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    if (isPro) {
      // Pro users have unlimited access, so we can grant a token directly.
    } else {
      // For free users, check usage limits.
      const FREE_TIER_LIMIT_SECONDS = 600; // 10 minutes
      if ((profile.usage_seconds || 0) >= FREE_TIER_LIMIT_SECONDS) {
        return new Response(JSON.stringify({ error: 'Usage limit exceeded. Please upgrade to Pro for unlimited access.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403, // Forbidden
        });
      }
    }

    const assemblyai = createAssemblyAI();
    const token = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: error.message || 'An unexpected error occurred' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

// Start the server with the real dependencies
serve((req) => {
  const supabaseClientFactory = (authHeader) =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

  const assemblyAIFactory = () =>
    new AssemblyAI({
      apiKey: Deno.env.get('ASSEMBLYAI_API_KEY'),
    });

  return handler(req, supabaseClientFactory, assemblyAIFactory);
});
