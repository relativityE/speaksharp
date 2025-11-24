import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

// Define the handler with dependency injection for testability
export async function handler(req: Request, createSupabase: SupabaseClientFactory) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Production mode: Standard user authentication and "pro" plan check.
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createSupabase(authHeader);

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .single();

    if (profileError) {
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

    const { transcript } = await req.json();
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

    const prompt = `
      You are an expert public speaking coach. Analyze the following speech transcript and provide constructive feedback.
      The user wants to improve their communication skills. Focus on clarity, pacing, filler words, and overall impact.

      Transcript:
      "${transcript}"

      Your response MUST be a JSON object with the following structure:
      {
        "summary": "A one-sentence overall summary of the feedback.",
        "suggestions": [
          { "title": "Clarity", "description": "Specific feedback on clarity." },
          { "title": "Pacing", "description": "Specific feedback on pacing." },
          { "title": "Filler Words", "description": "Specific feedback on filler words." },
          { "title": "Engagement", "description": "Specific feedback on audience engagement." }
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
