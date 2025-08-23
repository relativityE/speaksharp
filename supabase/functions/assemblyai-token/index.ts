import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { AssemblyAI } from 'https://esm.sh/assemblyai@4.15.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define the handler with dependency injection for testability
export async function handler(
  req: Request,
  createSupabase: (authHeader: string) => SupabaseClient,
  createAssemblyAI: () => AssemblyAI
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createSupabase(authHeader);

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
    if (!isPro) {
      return new Response(JSON.stringify({ error: 'User is not on a Pro plan' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const assemblyai = createAssemblyAI();
    const token = await assemblyai.realtime.createTemporaryToken({ expires_in: 3600 });

    return new Response(JSON.stringify({ token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'An unexpected error occurred' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

// Start the server with the real dependencies
serve((req) => {
    const supabaseClientFactory = (authHeader: string) => createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
    );
    const assemblyAIFactory = () => new AssemblyAI({ apiKey: Deno.env.get('ASSEMBLYAI_API_KEY')! });

    return handler(req, supabaseClientFactory, assemblyAIFactory);
});
