import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

interface SuggestionItem {
  title: string;
  description: string;
}

interface AISuggestions {
  summary: string;
  suggestions: SuggestionItem[];
}

const FALLBACK_SUGGESTIONS: AISuggestions = {
  summary: 'AI suggestions are temporarily unavailable for this session.',
  suggestions: [
    {
      title: 'Review Transcript',
      description: 'Read through the saved transcript and compare it with your session metrics while suggestions are retried later.',
    },
  ],
};

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (error) {
    console.warn('AI suggestions response was not valid JSON before object extraction fallback:', error);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return cleaned.slice(start, end + 1);
  }
}

function isSuggestionItem(value: unknown): value is SuggestionItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === 'string' && typeof item.description === 'string';
}

function parseSuggestions(rawText: string): AISuggestions | null {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.summary !== 'string') return null;
    if (!Array.isArray(candidate.suggestions)) return null;
    if (!candidate.suggestions.every(isSuggestionItem)) return null;

    return {
      summary: candidate.summary,
      suggestions: candidate.suggestions,
    };
  } catch (error) {
    console.error('Failed to parse AI suggestions JSON:', error);
    return null;
  }
}

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

    const { transcript, metrics, sessionId } = await req.json();

    // 1. OPTIMIZATION: Check for existing suggestions if sessionId is provided
    if (sessionId) {
      const { data: session, error: sessionError } = await supabaseClient
        .from('sessions')
        .select('ai_suggestions')
        .eq('id', sessionId)
        .single();

      if (!sessionError && session?.ai_suggestions) {
        return new Response(JSON.stringify({ suggestions: session.ai_suggestions }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    }

    if (!transcript) {
      return new Response(JSON.stringify({ error: 'Transcript is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS, degraded: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
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
      You are an expert public speaking coach. Analyze the following speech transcript and metrics as if the user wants practical coaching they can use in the next practice session.
      Go beyond delivery metrics. Evaluate the speech content's logical structure, vocabulary variety, sentence variety, transitions, specificity, and audience impact in addition to pacing, clarity, pauses, and filler words.

      Coaching rules:
      - Be specific and evidence-based. Reference short phrases or patterns from the transcript when useful.
      - Do not invent facts, audience context, or performance details not present in the transcript or metrics.
      - Prefer concrete rewrites, next-step drills, or "try saying..." examples over generic encouragement.
      - If the transcript is too short for a category, say what additional evidence would make that category measurable.
      - Keep every description concise enough to display in the app.

      Transcript:
      "${transcript}"
      ${metricsText}

      Your response MUST be a JSON object with the following structure:
      {
        "summary": "A one-sentence overall summary of the feedback.",
        "suggestions": [
          { "title": "Structure & Flow", "description": "Assess opening, logical order, transitions, and conclusion. Include one concrete improvement." },
          { "title": "Vocabulary & Variety", "description": "Assess repeated wording, sentence variety, specificity, and word choice. Suggest one stronger phrasing option if useful." },
          { "title": "Audience Impact", "description": "Assess whether the message is clear, memorable, and persuasive for a listener. Suggest one way to make it land better." },
          { "title": "Delivery & Clutter", "description": "Use metrics for pacing, pauses, filler words, and clarity. Give one next-practice drill." }
        ]
      }
    `;

    let suggestions: AISuggestions | null = null;

    try {
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
      } else {
        const responseData = await geminiResponse.json();
        const rawText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
        suggestions = typeof rawText === 'string'
          ? parseSuggestions(rawText)
          : null;
      }
    } catch (error) {
      console.error('Gemini API request failed:', error);
    }

    if (!suggestions) {
      console.error('Gemini response did not contain valid suggestions JSON.');
      return new Response(JSON.stringify({ suggestions: FALLBACK_SUGGESTIONS, degraded: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 2. PERSISTENCE: Save the new suggestions if sessionId is provided
    if (sessionId) {
      const { error: updateError } = await supabaseClient
        .from('sessions')
        .update({ ai_suggestions: suggestions })
        .eq('id', sessionId);

      if (updateError) {
        console.error('Failed to save AI suggestions to cache:', updateError);
      }
    }

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

// Start the server with the real dependencies.
if (import.meta.main) {
  serve((req: Request) => {
    const supabaseClientFactory: SupabaseClientFactory = (authHeader) =>
      createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader! } } }
      );

    return handler(req, supabaseClientFactory);
  });
}
