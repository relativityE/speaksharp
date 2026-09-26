import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders as buildCorsHeaders } from '../_shared/cors.ts';
import coachingContract from './contract.json' with { type: 'json' };

// #1416 — `gemini-3-flash-preview` is a PREVIEW endpoint and Google lists `gemini-3.6-flash` as its
// successor. Preview shutdowns have run 14 days from announcement, so this is an availability risk in
// production rather than a version-number preference: the endpoint can disappear inside a sprint.
//
// The prompt below was tuned against the preview model, so the risk of this change is a SHAPE shift,
// not a quality one — `parseSuggestions` already rejects any object whose keys are not exactly
// {version, what_worked, what_to_try_next}, and that rejection is what must reach the user as an
// error rather than as an empty review.
export const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${coachingContract.model}:generateContent`;
// #1424 (Codex finding): the request used to constrain its answer by PROMPT WORDING alone, and
// `parseSuggestions` then demanded exactly {version, what_worked, what_to_try_next}. That made the contract a
// request rather than a constraint: a model is free to wrap its answer in a markdown fence or add a key, and
// every such answer is a 502 for every user. An executed call proving the model complied ONCE is evidence
// about that call, not a guarantee about the next one.
//
// Declaring the MIME type and schema moves the contract into the API, where the provider enforces it. The
// literal is written as valid JSON on purpose: the G4 proof parses this exact object out of this file and
// sends it, so the proof cannot drift from what production requests.
//
// `version` carries an `enum`, not a bare STRING (Codex finding). Typing it as STRING alone lets the model
// return any version string the schema considers valid, which `parseSuggestions` then rejects - a 502 we
// asked for. The values the parser demands and the values the schema permits have to be the same set.
/**
 * #1424 A2 - the two-phrase coaching format, as ONE definition.
 *
 * The product format is two phrases of at most 6 words each.
 *
 * The release-and-iterate policy carried two different budgets - 6 for what worked, 8 for try next - which
 * gave two numbers to remember, two ways to be wrong, and no reason for the asymmetry. PO ruling: reconcile
 * both to one number. Six, and measured rather than chosen: 3.6 writes to FILL whatever budget it is given
 * - 5 and 5 words under a six-word budget, 6 and 7 under a seven-word one - so slack buys no margin, it just
 * gets spent. A field landing ON the limit is one word from a 502. Six is also the number the policy already
 * carried for "what worked", so this reconciles to an existing number rather than inventing one. The
 * shipped prompt never said so - its only length instruction was "concise enough to display in the app" -
 * so the model returned 22-36 words per field and nothing truncated it in the UI. The user read whatever
 * arrived.
 *
 * The budget is enforced in all three places a violation can enter: asked for in the PROMPT, capped in the
 * SCHEMA, and refused by the PARSER. Prompt wording alone is a request; only the parser is a guarantee.
 */
export const COACHING_WORD_BUDGET = Object.freeze(coachingContract.wordBudget);

/** Words, counted the way a reader would: runs of non-whitespace. */
export const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

export const GEMINI_GENERATION_CONFIG = coachingContract.generationConfig;

/**
 * #1486 — THE PROVIDER RETRY LIVES HERE, BEHIND THE ONE QUOTA CONSUMPTION.
 *
 * Quota is consumed once, above, before the provider is ever called. A retry that re-enters this function
 * therefore charges the user a second time for a single generation action, and if the first attempt spent
 * their last slot the retry answers 429 — reporting a limit they never reached for what was a provider
 * outage. Retrying INSIDE the one consumption is the only place a second provider attempt costs nothing.
 *
 * Two attempts, and only for a failure another attempt could actually change: a transport error, or a 5xx
 * the provider itself served. A 4xx is our request and will be refused identically. A 200 whose body fails
 * `parseSuggestions` is a contract violation, not a blip, and is answered rather than re-asked.
 */
export const AI_PROVIDER_ATTEMPTS = 2;

const MAX_TRANSCRIPT_CHARS = 8000;
// #1424 A1. Lowered from 20 with #1422's P2-4 in view: the review now fires automatically at post-save
// readiness rather than on a click, so the ceiling is reached by ordinary use rather than by deliberate
// retries. Note this is a DAILY cap and the binding provider constraint is per-MINUTE (see the operating
// note in the PR body) - a daily number cannot prevent a burst.
export const AI_SUGGESTION_DAILY_LIMIT = coachingContract.uncachedGenerationCapPerUtcDay;

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;
type ServiceRoleClientFactory = () => SupabaseClient;

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
  /** #1258: the per-word counts saves now write; `filler_words` is stripped on save and kept only for legacy rows. */
  filler_counts: unknown;
  clarity_score: number | null;
  wpm: number | null;
  pause_metrics: unknown;
  ai_suggestions: unknown;
}

/** Only deployment skew (Edge published before its migration) may use the legacy authenticated write. */
function authorityRpcUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'PGRST202' || code === '42883';
}
/**
 * `enforceWordBudget` separates two jobs this parser does, which are not the same contract (Codex P1).
 *
 * GENERATING: the model's fresh answer must obey the budget, or the user reads an essay where the product
 * promises a phrase.
 *
 * READING WHAT IS ALREADY STORED: every review generated before the budget existed is 22-36 words - that is
 * precisely what the old prompt produced. Applying the budget to a stored row would make coaching a user
 * already received suddenly unreadable, and it would not merely hide it: an expired transcript would 409, an
 * expired account 403, and an active user would silently regenerate and spend quota to replace coaching that
 * was already fine. A rule introduced today must not retroactively invalidate what the product said
 * yesterday.
 */
export function parseSuggestions(rawText: string, { enforceWordBudget = false } = {}): AISuggestions | null {
  try {
    const parsed = JSON.parse(rawText.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const candidate = parsed as Record<string, unknown>;
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['version', 'what_to_try_next', 'what_worked'])) return null;
    if (candidate.version !== 'gemini_coaching_v1') return null;
    if (typeof candidate.what_worked !== 'string' || !candidate.what_worked.trim()) return null;
    if (typeof candidate.what_to_try_next !== 'string' || !candidate.what_to_try_next.trim()) return null;
    // #1424 A2: the word budget is REFUSED, not truncated. Cutting a coaching phrase mid-sentence produces
    // something the coach never said, and presenting that as advice is worse than an honest failure the user
    // can retry. Applied to GENERATION only — see the note on `enforceWordBudget`.
    if (enforceWordBudget) {
      if (countWords(candidate.what_worked) > COACHING_WORD_BUDGET.what_worked) return null;
      if (countWords(candidate.what_to_try_next) > COACHING_WORD_BUDGET.what_to_try_next) return null;
    }

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

/**
 * Build the exact prompt sent to Gemini from the same inert contract used by the trusted proof harness.
 * Replacements happen before caller content is inserted, so transcript text that happens to contain a
 * placeholder cannot alter the metrics boundary.
 */
/**
 * #1258 — FOCUS POINTS CONTEXT FOR COACHING (runbook v12, PM order item 4).
 *
 * A Focus Points session's coaching must help the person cover THEIR chosen points. The saved results live in the
 * objective tables linked to this session (`objective_session.source_session_id`), read here under the caller's RLS.
 * `none` means the session is not a Focus Points take (no objective session is linked to it); `pending` means it IS
 * one but its point results are not saved yet; `error` means the read failed. Neither `pending` nor `error` may ever
 * become generic coaching.
 */
export interface FocusPointEvidence {
  label: string;
  verdict: 'detected' | 'not_detected' | 'unavailable';
  detectedAtSeconds: number | null;
}
export type FocusContext =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'focus'; topic: string | null; points: FocusPointEvidence[] }
  | { kind: 'error' };

const FOCUS_VERDICTS = new Set(['detected', 'not_detected', 'unavailable']);
const MAX_FOCUS_LABEL_CHARS = 200;

export async function loadFocusContext(client: SupabaseClient, sessionId: string): Promise<FocusContext> {
  const { data: objective, error: objectiveError } = await client
    .from('objective_session')
    .select('id, brief_id')
    .eq('source_session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (objectiveError) return { kind: 'error' };
  if (!objective) return { kind: 'none' };
  const { id: objectiveId, brief_id: briefId } = objective as { id: string; brief_id: string };
  const [brief, points, evidence] = await Promise.all([
    client.from('objective_brief').select('event_goal').eq('id', briefId).maybeSingle(),
    client.from('objective_brief_point').select('id, label, sort_order').eq('brief_id', briefId).order('sort_order', { ascending: true }),
    client.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds').eq('session_id', objectiveId),
  ]);
  if (brief.error || points.error || evidence.error) return { kind: 'error' };
  const pointRows = (points.data ?? []) as Array<{ id: string; label: string }>;
  const evidenceRows = (evidence.data ?? []) as Array<{ brief_point_id: string; verdict: string; detected_at_seconds: number | null }>;
  // A linked Focus take with no points or no evidence yet has no result: it is pending, never an Open Mic take.
  if (pointRows.length === 0 || evidenceRows.length === 0) return { kind: 'pending' };
  const byPoint = new Map(evidenceRows.map((row) => [row.brief_point_id, row]));
  const topic = typeof (brief.data as { event_goal?: unknown } | null)?.event_goal === 'string'
    ? (brief.data as { event_goal: string }).event_goal
    : null;
  return {
    kind: 'focus',
    topic,
    points: pointRows.map((point) => {
      const row = byPoint.get(point.id);
      const verdict = row && FOCUS_VERDICTS.has(row.verdict) ? row.verdict as FocusPointEvidence['verdict'] : 'unavailable';
      const at = verdict === 'detected' && typeof row?.detected_at_seconds === 'number' ? row.detected_at_seconds : null;
      return { label: point.label, verdict, detectedAtSeconds: at };
    }),
  };
}

const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// The person's own point text, bounded and flattened so it cannot restructure the prompt around it.
const quoteLabel = (text: string): string => `"${text.replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_LABEL_CHARS)}"`;

/**
 * The Focus Points section appended to the metrics block. It states each chosen point, in order, with what the
 * keyword matcher found, and the rules that make the two phrases about COVERING THESE POINTS: supported pace and
 * placement advice, no invented misses, and "not detected" never presented as proof a point was skipped.
 */
export function buildFocusCoachingText(context: FocusContext): string {
  if (context.kind !== 'focus') return '';
  const lines = context.points.map((point, index) => {
    const result = point.verdict === 'detected'
      ? `detected${point.detectedAtSeconds !== null ? ` at ${clockText(point.detectedAtSeconds)}` : ''}`
      : point.verdict === 'not_detected'
        ? 'not detected by the keyword matcher (the speaker may have covered it in other words)'
        : 'not checked';
    return `      ${index + 1}. ${quoteLabel(point.label)}: ${result}`;
  });
  const allDetected = context.points.every((point) => point.verdict === 'detected');
  return `
      Focus Points session. The speaker chose these points to cover, in this order${context.topic ? `, for the topic ${quoteLabel(context.topic)}` : ''}. A keyword matcher checked the transcript for each:
${lines.join('\n')}

      Focus Points coaching rules:
      - Both phrases must help the speaker cover THESE chosen points in the next run: which point to open, introduce or signpost, where it belongs, or pacing between points, when this transcript and these results support it.
      - "Not detected" is only what the matcher found. Never say a point was missed, skipped or not mentioned; suggest how to make it unmistakable instead.
${allDetected ? '      - Every point was detected. Do not suggest covering a point as if it were missing; coach placement, transitions or pace between points.\n' : ''}`;
}

export function buildCoachingPrompt(transcriptForPrompt: string, metricsText: string): string {
  return coachingContract.promptTemplate.replace(
    /\{\{(TRANSCRIPT|METRICS)\}\}/g,
    (_marker, name: string) => name === 'TRANSCRIPT' ? transcriptForPrompt : metricsText,
  );
}

// Define the handler with dependency injection for testability
export async function handler(
  req: Request,
  createSupabase: SupabaseClientFactory,
  createServiceRoleSupabase: ServiceRoleClientFactory = () => createSupabase(null),
) {
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
      // #1473 — 42501: the caller's role lacks the privilege to read its own profile. That is a SERVICE CONFIGURATION
      // failure, not the user's account and not a transient outage, so it gets one closed, allowlisted code the client
      // can act on. The body names no table, role or database detail, and nothing past this point (quota, provider,
      // persistence) runs. Only this code maps here: PGRST116 stays authentication, and anything else — including a
      // forged-token PGRST301 — stays the generic fail-closed 500.
      if (profileError.code === '42501') {
        console.error('Profile read refused: service configuration (42501).');
        return new Response(JSON.stringify({
          error: 'AI coaching is unavailable right now.',
          code: 'service_configuration',
        }), {
          headers: { ...responseHeaders, 'Content-Type': 'application/json' },
          status: 503,
        });
      }
      console.error('Profile fetch error:', profileError);
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const body = await req.json() as { sessionId?: unknown; product?: unknown };
    const sessionId = body.sessionId;
    // #1258: the page's statement that this take was Focus Points. It can only make the request STRICTER (refuse
    // generic coaching when the saved results are missing); it never supplies evidence.
    const expectsFocusPoints = body.product === 'focus_points';
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
      .select('transcript, transcript_state, duration, total_words, filler_words, filler_counts, clarity_score, wpm, pause_metrics, ai_suggestions')
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

    // #1258 (PM 2026-09-26) — FOCUS RESULTS ARE CHECKED BEFORE ANY CACHED PAIR IS RETURNED AS FOCUS COACHING. A pair
    // cached for this session is replayed to a Focus Points request only once its saved point results exist; until
    // then the request is refused 425 (nothing spent, nothing replayed), exactly as a first request would be.
    const focusResultsUnready = (context: FocusContext) =>
      context.kind === 'pending' || (expectsFocusPoints && context.kind !== 'focus');
    const refuseFocusRead = (context: FocusContext): Response | null => {
      if (context.kind === 'error') {
        return new Response(JSON.stringify({ error: 'AI coaching is unavailable right now. Please try again.' }), {
          headers: { ...responseHeaders, 'Content-Type': 'application/json' },
          status: 503,
        });
      }
      if (focusResultsUnready(context)) {
        return new Response(JSON.stringify({ error: 'Focus Points results are not ready yet. Please try again.', code: 'focus_results_pending' }), {
          headers: { ...responseHeaders, 'Content-Type': 'application/json' },
          status: 425,
        });
      }
      return null;
    };
    let focusContext: FocusContext | null = null;
    if (expectsFocusPoints) {
      focusContext = await loadFocusContext(supabaseClient, sessionId);
      const refused = refuseFocusRead(focusContext);
      if (refused) return refused;
    }

    const cachedSuggestions = session.ai_suggestions
      ? parseSuggestions(JSON.stringify(session.ai_suggestions))
      : null;
    if (cachedSuggestions) {
      // A cache replay is evidence only when the server-owned receipt records that the request really
      // returned before quota/provider work. The browser packet cannot assert this fact for itself.
      const { data: cacheRecorded, error: cacheReceiptError } = await createServiceRoleSupabase().rpc(
        'record_ai_suggestion_cache_read_v1',
        { p_session_id: sessionId, p_user_id: userId },
      );
      if (cacheReceiptError || cacheRecorded !== true) {
        // Legacy cached coaching predates the authority receipt. Keep the already-saved product result
        // readable; the trusted evidence collector still HOLDs because no receipt/cache count exists.
        console.error('AI coaching cache authority was not recorded:', cacheReceiptError);
      }
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

    // #1258 — the session's saved Focus Points results, read BEFORE entitlement and quota so a refusal spends nothing.
    // A failed read, or a Focus Points take whose results are not saved yet, must never become generic coaching:
    // the answer would be cached on the row and the person could never get coaching about their points. `pending` is
    // refused even when the request names no product (a tab loaded before this deploy), so no generic pair can be
    // cached for a Focus take and later replayed as its Focus coaching.
    if (!focusContext) {
      focusContext = await loadFocusContext(supabaseClient, sessionId);
      const refused = refuseFocusRead(focusContext);
      if (refused) return refused;
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

    // #1258: saves write `filler_counts` and strip `filler_words`, so reading only the legacy field told the model
    // "N/A" for every new session. The legacy field remains the fallback for rows saved before the switch.
    const fillerEvidence = session.filler_counts ?? session.filler_words;
    const metricsText = `
      Metrics:
      - Words Per Minute (WPM): ${session.wpm ?? 'N/A'}
      - Clarity Score: ${session.clarity_score ?? 'N/A'}%
      - Total Words: ${session.total_words ?? 'N/A'}
      - Duration: ${session.duration ?? 'N/A'} seconds
      - Pause Metrics: ${session.pause_metrics == null ? 'N/A' : JSON.stringify(session.pause_metrics)}
      - Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}
    ` + buildFocusCoachingText(focusContext);

    const prompt = buildCoachingPrompt(transcriptForPrompt, metricsText);

    let suggestions: AISuggestions | null = null;
    let observedProviderModel: string | null = null;

    for (let providerAttempt = 1; providerAttempt <= AI_PROVIDER_ATTEMPTS; providerAttempt += 1) {
      // Only a transport error or a provider 5xx earns the second attempt. Set where the failure is known.
      let providerFailureIsRetryable = false;
      try {
        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: GEMINI_GENERATION_CONFIG,
          }),
        });

        if (!geminiResponse.ok) {
          const errorBody = await geminiResponse.text();
          console.error('Gemini API request failed:', errorBody);
          providerFailureIsRetryable = geminiResponse.status >= 500;
        } else {
          const responseData = await geminiResponse.json();
          const rawText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
          observedProviderModel = typeof responseData?.modelVersion === 'string'
            && /^[A-Za-z0-9._:-]{1,128}$/.test(responseData.modelVersion)
            ? responseData.modelVersion
            : null;
          suggestions = typeof rawText === 'string'
            // The model's FRESH answer — the one place the budget is enforced.
            ? parseSuggestions(rawText, { enforceWordBudget: true })
            : null;
        }
      } catch (error) {
        console.error('Gemini API request failed:', error);
        providerFailureIsRetryable = true;
      }

      // A complete answer ends the loop. So does a failure a second ask cannot change.
      if (suggestions && observedProviderModel) break;
      if (!providerFailureIsRetryable) break;
    }

    if (!suggestions || !observedProviderModel) {
      console.error('Gemini response did not contain valid suggestions JSON.');
      return new Response(JSON.stringify({ error: 'AI coaching could not be generated. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 502,
      });
    }

    const quotaLimit = quotaResult?.limit;
    const quotaRequestNumber = quotaResult?.used;
    if (!Number.isInteger(quotaLimit) || !Number.isInteger(quotaRequestNumber)
      || Number(quotaLimit) <= 0 || Number(quotaRequestNumber) <= 0
      || Number(quotaRequestNumber) > Number(quotaLimit)) {
      console.error('AI suggestion quota receipt was incomplete.');
      return new Response(JSON.stringify({ error: 'AI coaching authority could not be verified. Please try again.' }), {
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
        status: 503,
      });
    }

    // Persist the coaching value and its provider/quota authority in one service-role transaction.
    // The browser's authenticated client cannot execute this RPC or write the receipt table.
    const { data: authoritySavedValue, error: authorityUpdateError } = await createServiceRoleSupabase().rpc(
      'persist_ai_suggestion_with_authority_v1',
      {
        p_session_id: sessionId,
        p_user_id: userId,
        p_suggestions: suggestions,
        p_provider: 'google_gemini',
        p_model: observedProviderModel,
        p_quota_scope: 'user_utc_day',
        p_quota_utc_date: new Date().toISOString().slice(0, 10),
        p_quota_limit: quotaLimit,
        p_quota_request_number: quotaRequestNumber,
      },
    );

    // Merging this function deploys Edge code before the separately authorized database migration.
    // During that bounded skew, preserve the existing product save through the authenticated/RLS path.
    // The trusted evidence collector still HOLDs because this path creates no authority receipt. Once
    // the migration is present its ACL removes this browser write and the atomic RPC is mandatory.
    let savedValue = authoritySavedValue;
    let updateError = authorityUpdateError;
    if (authorityRpcUnavailable(authorityUpdateError)) {
      const legacy = await supabaseClient
        .from('sessions')
        .update({ ai_suggestions: suggestions })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select('ai_suggestions')
        .single();
      savedValue = legacy.data?.ai_suggestions ?? null;
      updateError = legacy.error;
    }

    const savedSuggestions = !updateError && savedValue
      ? parseSuggestions(JSON.stringify(savedValue))
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
    const serviceRoleClientFactory: ServiceRoleClientFactory = () =>
      createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

    return handler(req, supabaseClientFactory, serviceRoleClientFactory);
  });
}
