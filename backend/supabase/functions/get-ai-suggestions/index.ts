import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

// Define the handler with dependency injection for testability
export async function handler(req: Request, createSupabase: SupabaseClientFactory) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Production mode: Use RLS to enforce auth - no need for separate getUser() call
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createSupabase(authHeader);

    // RLS policy on user_profiles enforces that users can only access their own profile
    // This eliminates the redundant getUser() + eq('id', user.id) pattern
    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('subscription_status')
      .single();

    if (profileError) {
      // PGRST116 = "No rows returned" which means no authenticated user (RLS blocked)
      if (profileError.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Authentication failed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }
      console.error('Profile fetch error:', profileError);
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const isPro = profile?.subscription_status === 'pro';
    if (!isPro) {
      return new Response(JSON.stringify({ error: 'User is not on a Pro plan' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const { transcript, metrics } = await req.json();
    if (!transcript) {
      return new Response(JSON.stringify({ error: 'Transcript is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      return new Response(JSON.stringify({ error: 'The server is not configured for AI suggestions. Please contact support.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const metricsText = metrics ? `
      Metrics:
      - Words Per Minute (WPM): ${metrics.wpm || 'N/A'}
      - Clarity Score: ${metrics.clarity_score || 'N/A'}%
      - Total Words: ${metrics.total_words || 'N/A'}
      - Duration: ${metrics.duration || 'N/A'} seconds
      - Pause Metrics: ${metrics.pause_metrics ? JSON.stringify(metrics.pause_metrics) : 'N/A'}
      - Filler Words: ${metrics.filler_words ? JSON.stringify(metrics.filler_words) : 'N/A'}
    ` : '';

    const prompt = `
      You are an expert public speaking coach. Analyze the following speech transcript and metrics to provide constructive, data-driven feedback.
      The user wants to improve their communication skills. Focus on clarity, pacing, filler words, and overall impact.

      Transcript:
      "${transcript}"
      ${metricsText}

      Your response MUST be a JSON object with the following structure:
      {
        "summary": "A one-sentence overall summary of the feedback.",
        "suggestions": [
          { "title": "Clarity", "description": "Specific feedback on clarity based on score and transcript." },
          { "title": "Pacing", "description": "Specific feedback on pacing based on WPM and pauses." },
          { "title": "Filler Words", "description": "Specific feedback on filler word usage." },
          { "title": "Engagement", "description": "Specific feedback on audience engagement and tone." }
        ]
      }
    `;

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error('Gemini API request failed:', errorBody);
      throw new Error(`Gemini API error: ${geminiResponse.statusText}`);
    }

    const responseData = await geminiResponse.json();
    const rawText = responseData.candidates[0].content.parts[0].text;
    const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const suggestions = JSON.parse(jsonText);

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    const errorMessage = (error instanceof Error) ? error.message : 'An unexpected error occurred';
    return new Response(JSON.stringify({ error: `Failed to get AI suggestions. ${errorMessage}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

// Start the server with the real dependencies
serve((req: Request) => {
  const supabaseClientFactory: SupabaseClientFactory = (authHeader) =>
    createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader! } } }
    );

  return handler(req, supabaseClientFactory);
});
