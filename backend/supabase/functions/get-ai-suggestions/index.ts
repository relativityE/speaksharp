import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders as buildCorsHeaders } from '../_shared/cors.ts';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
const MAX_TRANSCRIPT_CHARS = 8000;
const AI_SUGGESTION_DAILY_LIMIT = 20;

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

interface AISuggestions {
  version: 'gemini_coaching_v1';
  what_worked: string;
  what_to_try_next: string;
}

interface QuotaResult {
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
  error?: string;
}

interface SessionEvidence {
  transcript: string | null;
  transcript_state: string | null;
  duration: number | null;
  total_words: number | null;
  filler_words: unknown;
  clarity_score: number | null;
  wpm: number | null;
  pause_metrics: unknown;
  ai_suggestions: unknown;
}

function parseSuggestions(rawText: string): AISuggestions | null {
  try {
    const parsed = JSON.parse(rawText.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const candidate = parsed as Record<string, unknown>;
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['version', 'what_to_try_next', 'what_worked'])) return null;
    if (candidate.version !== 'gemini_coaching_v1') return null;
    if (typeof candidate.what_worked !== 'string' || !candidate.what_worked.trim()) return null;
    if (typeof candidate.what_to_try_next !== 'string' || !candidate.what_to_try_next.trim()) return null;

    return {
      version: 'gemini_coaching_v1',
      what_worked: candidate.what_worked.trim(),
      what_to_try_next: candidate.what_to_try_next.trim(),
    };
  } catch (error) {
    console.error('Failed to parse AI suggestions JSON:', error);
    return null;
  }
}

// Define the handler with dependency injection for testability
export async function handler(req: Request, createSupabase: SupabaseClientFactory) {
  // Exact-origin CORS guard: reject hostile/unapproved origins and answer preflight BEFORE any
  // auth or Supabase/AI provider access.
  const corsRejection = corsGuard(req);
  if (corsRejection) return corsRejection;

  const responseHeaders = buildCorsHeaders(req);

  try {
    // Production mode: Use RLS to enforce auth - no need for separate getUser() call
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createSupabase(authHeader);

    // RLS policy on user_profiles enforces that users can only access their own profile
    // This eliminates the redundant getUser() + eq('id', user.id) pattern
    const { error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('id')
      .single();

    if (profileError) {
      // PGRST116 = "No rows returned" which means no authenticated user (RLS blocked)
      if (profileError.code === 'PGRST116') {
        return new Response(JSON.stringify({ error: 'Authentication failed' }), {
          headers: { ...responseHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }
      console.error('Profile fetch error:', profileError);
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const body = await req.json() as { sessionId?: unknown };
    const sessionId = body.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return new Response(JSON.stringify({ error: 'Session ID is required' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id ?? null;
    if (userError || !userId) {
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    // The saved, RLS-owned session is the only coaching evidence authority. Caller-supplied
    // transcript/metrics are deliberately ignored so one session cannot be relabelled as another.
    const { data: sessionData, error: sessionError } = await supabaseClient
      .from('sessions')
      .select('transcript, transcript_state, duration, total_words, filler_words, clarity_score, wpm, pause_metrics, ai_suggestions')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: 'Session was not found' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    const session = sessionData as SessionEvidence;
    const cachedSuggestions = session.ai_suggestions
      ? parseSuggestions(JSON.stringify(session.ai_suggestions))
      : null;
    if (cachedSuggestions) {
      return new Response(JSON.stringify({ suggestions: cachedSuggestions }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (session.transcript_state !== 'available' || typeof session.transcript !== 'string' || !session.transcript.trim()) {
      return new Response(JSON.stringify({ error: 'AI coaching requires an available saved transcript' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 409,
      });
    }

    // Generating new coaching is an analysis operation, so it uses the same server-authoritative
    // commercial entitlement seam as recording. A marked active trial and a paid subscription both
    // pass; an expired/unpaid account fails closed. Cached coaching above remains readable after expiry.
    const { data: entitlement, error: entitlementError } = await supabaseClient.rpc('check_usage_limit');
    if (entitlementError) {
      console.error('Entitlement check failed:', entitlementError);
      return new Response(JSON.stringify({ error: 'Unable to verify analysis access' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 503,
      });
    }
    if (entitlement?.can_start !== true || entitlement?.is_pro !== true) {
      return new Response(JSON.stringify({ error: 'Trial has ended' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 403,
      });
    }

    const transcriptForPrompt = session.transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${session.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for coaching request length.]`
      : session.transcript;

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      return new Response(JSON.stringify({ error: 'AI coaching is unavailable right now. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 503,
      });
    }

    const { data: quota, error: quotaError } = await supabaseClient.rpc('consume_ai_suggestion_quota', {
      p_limit: AI_SUGGESTION_DAILY_LIMIT,
    });

    if (quotaError) {
      console.error('AI suggestion quota check failed:', quotaError);
      return new Response(JSON.stringify({ error: 'Unable to verify AI coaching quota. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 503,
      });
    }

    const quotaResult = quota as QuotaResult | null;
    if (quotaResult && quotaResult.allowed === false) {
      return new Response(JSON.stringify({
        error: 'Daily AI coaching limit reached. Try again tomorrow.',
        remaining: quotaResult.remaining ?? 0,
        limit: quotaResult.limit ?? AI_SUGGESTION_DAILY_LIMIT,
      }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 429,
      });
    }

    const metricsText = `
      Metrics:
      - Words Per Minute (WPM): ${session.wpm ?? 'N/A'}
      - Clarity Score: ${session.clarity_score ?? 'N/A'}%
      - Total Words: ${session.total_words ?? 'N/A'}
      - Duration: ${session.duration ?? 'N/A'} seconds
      - Pause Metrics: ${session.pause_metrics == null ? 'N/A' : JSON.stringify(session.pause_metrics)}
      - Filler Words: ${session.filler_words == null ? 'N/A' : JSON.stringify(session.filler_words)}
    `;

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
      "${transcriptForPrompt}"
      ${metricsText}

      Return exactly one JSON object and no surrounding prose or markdown:
      {
        "version": "gemini_coaching_v1",
        "what_worked": "One concise, session-specific interpretation of what worked and why it mattered.",
        "what_to_try_next": "One concrete, session-specific change for the next attempt."
      }
      Do not add keys. Metric recital or reusable generic advice is invalid.
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
      return new Response(JSON.stringify({ error: 'AI coaching could not be generated. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 502,
      });
    }

    // Persist and read back the exact value before reporting success.
    const { data: savedSession, error: updateError } = await supabaseClient
      .from('sessions')
      .update({ ai_suggestions: suggestions })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select('ai_suggestions')
      .single();

    const savedSuggestions = !updateError && savedSession?.ai_suggestions
      ? parseSuggestions(JSON.stringify(savedSession.ai_suggestions))
      : null;
    if (!savedSuggestions || JSON.stringify(savedSuggestions) !== JSON.stringify(suggestions)) {
      console.error('Failed to save and verify AI suggestions:', updateError);
      return new Response(JSON.stringify({ error: 'AI coaching could not be saved. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 503,
      });
    }

    return new Response(JSON.stringify({ suggestions: savedSuggestions }), {
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    return new Response(JSON.stringify({ error: 'Failed to get AI suggestions. Please try again.' }), {
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
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
