import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;
type AssemblyAIClientFactory = () => AssemblyAI;

export async function handler(req: Request, createSupabase: SupabaseClientFactory, createAssemblyAI: AssemblyAIClientFactory) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication failed: Missing Authorization header.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
      });
    }
    const supabaseClient = createSupabase(authHeader);

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('subscription_status, usage_seconds')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[assemblyai-token] Profile Error: Failed to fetch profile for user.', {
        userId: user.id,
        error: profileError?.message || 'No profile returned.',
      });
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const isPro = profile.subscription_status === 'pro' || profile.subscription_status === 'premium';
    if (!isPro) {
      const FREE_TIER_LIMIT_SECONDS = 600; // 10 minutes
      if ((profile.usage_seconds || 0) >= FREE_TIER_LIMIT_SECONDS) {
        return new Response(JSON.stringify({ error: 'Usage limit exceeded. Please upgrade to Pro for unlimited access.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        });
      }
    }

    const assemblyai = createAssemblyAI();
    const token = await assemblyai.realtime.createTemporaryToken({ expires_in: 600 });

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });

  } catch (error) {
    console.error('[assemblyai-token] Unexpected error:', error);
    const errorMessage = (error instanceof Error) ? error.message : 'An unexpected error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

serve((req: Request) => {
  const supabaseClientFactory: SupabaseClientFactory = (authHeader) =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader! } } }
    );

  const assemblyAIFactory: AssemblyAIClientFactory = () => {
    const apiKey = Deno.env.get('ASSEMBLYAI_API_KEY');
    if (!apiKey) {
      throw new Error('ASSEMBLYAI_API_KEY is not set in environment variables.');
    }
    return new AssemblyAI({ apiKey });
  }

  return handler(req, supabaseClientFactory, assemblyAIFactory);
});
