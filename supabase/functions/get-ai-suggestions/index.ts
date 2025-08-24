import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const devModeSecret = Deno.env.get('DEV_SECRET_KEY_V2');

    // Dev mode check
    if (!devModeSecret || authHeader !== `Bearer ${devModeSecret}`) {
      // Production mode: Standard user authentication and "pro" plan check.
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );

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

      const isPro = profile?.subscription_status === 'pro' || profile?.subscription_status === 'premium';
      if (!isPro) {
        return new Response(JSON.stringify({ error: 'User is not on a Pro plan' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        });
      }
    }
    // If in dev mode, we bypass the auth checks and proceed.

    const { transcript } = await req.json();
    if (!transcript) {
      return new Response(JSON.stringify({ error: 'Transcript is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // TODO: Add your Gemini API key to the Supabase project secrets.
    // 1. Go to your Supabase project dashboard.
    // 2. Navigate to Settings > Secrets.
    // 3. Click New Secret.
    // 4. Set the Name to GEMINI_API_KEY.
    // 5. Paste your API key into the Value field.
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      // Return a structured error that the client can display.
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

    // Clean the raw text to ensure it's valid JSON
    const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    // Parse the JSON string from the model's response
    const suggestions = JSON.parse(jsonText);

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    return new Response(JSON.stringify({ error: 'Failed to get AI suggestions. ' + error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
