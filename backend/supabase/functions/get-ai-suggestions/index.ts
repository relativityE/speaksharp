import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsGuard, corsHeaders as buildCorsHeaders } from '../_shared/cors.ts';
import coachingContract from './contract.json' with { type: 'json' };
import {
  decodeProviderAnswer, decodeProviderError, readBoundedBody, type ProviderAnswerCodes, type ProviderErrorCodes,
} from './providerDecode.ts';
import {
  attemptTimeoutMs, canAdmitAttempt, isRetryableProviderStatus, MAX_PROVIDER_ATTEMPTS, parseRetryAfter, planNextAttempt,
  realProviderRetryRuntime, type ProviderRetryRuntime, type RetryAfter,
} from './providerRetry.ts';

// #1416 — the original `gemini-3-flash-preview` endpoint was a PREVIEW channel and could disappear
// inside a sprint. The selected stable model is pinned in contract.json; runtime URL construction uses
// that single reviewed value rather than accepting a caller-supplied model ID.
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
 * #1424 A2 / #1258 - the two-phrase coaching format, as ONE definition.
 *
 * The product format is the #1548 1 + 1 rule: ONE "what worked" phrase and ONE "what to try next" phrase.
 *
 * PO DECISION (2026-10-02, recorded 5952285329): length is a SOFT TARGET, not a validity rule. The prompt asks
 * for about 8-10 words, one idea per phrase. The server enforces only what correctness needs - exact shape,
 * recognised version, non-empty fields and a generous CHARACTER ceiling (the schema's own `maxLength`) - and
 * records each served answer's word counts, whether it met the target, and whether it reads as a metric recital,
 * content-free. A phrase of 13 or 18 words is valid coaching and is served; it is never a 502 and never truncated.
 *
 * History: a six-word PARSER gate turned schema-valid answers of seven short words into a non-retryable 502
 * ("review unavailable", run 36955422629; real sessions 2026-09-14/15). Word count is a quality to measure and
 * improve through the prompt, not a reason to withhold coaching.
 */
export const COACHING_WORD_TARGET = Object.freeze(coachingContract.wordTarget);
/**
 * #1258 (Codex r4188372867) — the PO's soft target is ABOUT 8-10 words per phrase (the prompt says so). `within_target`
 * measures the whole band: a 1-7-word phrase is NOT within target. Measured content-free, never a validity rule.
 */
export const COACHING_WORD_TARGET_MIN = Object.freeze({ what_worked: 8, what_to_try_next: 8 });
/** The generous operational ceiling, one number: the provider schema's `maxLength`, also enforced here. */
export const COACHING_CHARACTER_CEILING = Object.freeze({
  what_worked: coachingContract.generationConfig.responseSchema.properties.what_worked.maxLength,
  what_to_try_next: coachingContract.generationConfig.responseSchema.properties.what_to_try_next.maxLength,
});

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
 * Only for a failure another attempt could actually change. #1258 option A (PM 6156942445): up to three attempts
 * inside one 45 s budget, with jittered backoff and the provider's own `Retry-After` — the whole policy, and the retry
 * set (408, 429, 5xx, transport, timeout), lives in `providerRetry.ts`. A 200 whose body fails `parseSuggestions` is a
 * contract violation, not a blip, and is answered rather than re-asked.
 */
export const AI_PROVIDER_ATTEMPTS = MAX_PROVIDER_ATTEMPTS;

/** The retry policy's clock, randomness and sleep. Tests replace `runtime`; production uses the real one. */
export const providerRetryHooks: { runtime: ProviderRetryRuntime } = { runtime: realProviderRetryRuntime };

const MAX_TRANSCRIPT_CHARS = 8000;
// #1424 A1. Lowered from 20 with #1422's P2-4 in view: the review now fires automatically at post-save
// readiness rather than on a click, so the ceiling is reached by ordinary use rather than by deliberate
// retries. Note this is a DAILY cap and the binding provider constraint is per-MINUTE (see the operating
// note in the PR body) - a daily number cannot prevent a burst.
export const AI_SUGGESTION_DAILY_LIMIT = coachingContract.uncachedGenerationCapPerUtcDay;

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;
type ServiceRoleClientFactory = () => SupabaseClient;

/**
 * #1538 (Codex P1 r4117321439) — the stored version is the pair's PROVENANCE. `gemini_coaching_focus_v1` is written only
 * for a pair generated from a Focus Points take's saved results; Open Mic (and every pair written before this change)
 * is `gemini_coaching_v1`. Exactly these two are accepted — no arbitrary version widening, no extra key.
 */
export type CoachingVersion = 'gemini_coaching_v1' | 'gemini_coaching_focus_v1';
const COACHING_VERSIONS: ReadonlySet<string> = new Set<CoachingVersion>(['gemini_coaching_v1', 'gemini_coaching_focus_v1']);

interface AISuggestions {
  version: CoachingVersion;
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
  /** The product's own saved next action for this take (`{ metric, ... }`); selects Focus Points' one delivery signal. */
  next_action_signal?: unknown;
  ai_suggestions: unknown;
  /** #1537: the durable product marker written at session creation; absent/NULL on rows created before it. */
  product?: unknown;
}

type SessionProduct = 'open_mic' | 'focus_points';
/**
 * #1538 Codex P1 r4118176188 (PM RETURN 5862477628) — DEPLOY-SKEW COMPATIBILITY, RESPONSE ONLY.
 *
 * Merging deploys this function independently of the frontend, and an open tab keeps its old bundle. That bundle's
 * parser accepts only `gemini_coaching_v1` and its request declares nothing, so a Focus pair labelled
 * `gemini_coaching_focus_v1` became a terminal "review unavailable" in a tab that had done nothing wrong.
 *
 * A client that reads Focus provenance says so with a CLOSED capability: `accepted_coaching_versions` must be an
 * array containing exactly `gemini_coaching_focus_v1`. It is separate from `product`, which stays a consistency
 * assertion and never becomes the protocol. Any other value (absent, a string, other casing, an unknown version) is a
 * legacy request, which receives a copy of the pair labelled `gemini_coaching_v1` with the same two phrases.
 *
 * Only the RESPONSE changes. The persisted row, the authority RPC value, the cache provenance and the trusted
 * readback keep `gemini_coaching_focus_v1`; nothing here is ever written back.
 */
const acceptsFocusCoaching = (value: unknown): boolean =>
  Array.isArray(value) && value.includes('gemini_coaching_focus_v1');

const forClient = (suggestions: AISuggestions, focusCapable: boolean): AISuggestions =>
  suggestions.version === 'gemini_coaching_focus_v1' && !focusCapable
    ? { ...suggestions, version: 'gemini_coaching_v1' }
    : suggestions;

const asProduct = (value: unknown): SessionProduct | null =>
  value === 'open_mic' || value === 'focus_points' ? value : null;
const SESSION_EVIDENCE_COLUMNS =
  'transcript, transcript_state, duration, total_words, filler_words, filler_counts, clarity_score, wpm, pause_metrics, next_action_signal, ai_suggestions';
/** Before migration 20260926190000 is applied the marker column does not exist; the row is then read as legacy. */
const isMissingProductColumn = (error: { code?: string; message?: string } | null | undefined): boolean =>
  Boolean(error && (error.code === '42703' || error.code === 'PGRST204') && /product/.test(error.message ?? ''));

/**
 * `enforceCharacterCeiling` separates two jobs this parser does, which are not the same contract (Codex P1).
 *
 * GENERATING: a fresh answer above the operational character ceiling is refused (a pathological answer, not a
 * long phrase - the ceiling is generous). Word count is never a validity rule (PO 2026-10-02).
 *
 * READING WHAT IS ALREADY STORED: reviews generated under earlier prompts can be long (22-36 words). A rule
 * introduced today must not retroactively make coaching a user already received unreadable, so stored reads
 * apply shape and version only.
 */
export function parseSuggestions(rawText: string, { enforceCharacterCeiling = false } = {}): AISuggestions | null {
  try {
    const parsed = JSON.parse(rawText.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const candidate = parsed as Record<string, unknown>;
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(['version', 'what_to_try_next', 'what_worked'])) return null;
    if (typeof candidate.version !== 'string' || !COACHING_VERSIONS.has(candidate.version)) return null;
    if (typeof candidate.what_worked !== 'string' || !candidate.what_worked.trim()) return null;
    if (typeof candidate.what_to_try_next !== 'string' || !candidate.what_to_try_next.trim()) return null;
    // Refused, never truncated: cutting advice changes what the coach said.
    if (enforceCharacterCeiling) {
      if (candidate.what_worked.trim().length > COACHING_CHARACTER_CEILING.what_worked) return null;
      if (candidate.what_to_try_next.trim().length > COACHING_CHARACTER_CEILING.what_to_try_next) return null;
    }

    return {
      version: candidate.version as CoachingVersion,
      what_worked: candidate.what_worked.trim(),
      what_to_try_next: candidate.what_to_try_next.trim(),
    };
  } catch (error) {
    // #1258 (PM 5953504835): the error NAME only. A JSON SyntaxError message quotes the text it failed on — model output.
    console.error('Failed to parse AI suggestions JSON.', JSON.stringify({ error: error instanceof Error ? error.name : 'unknown' }));
    return null;
  }
}

/**
 * #1258 (run 36955422629, PM 5945472679) — WHY a generation failed, as a closed, content-free reason.
 *
 * Every provider-side failure used to end in one generic 502 line, so an Edge log could not say whether the provider
 * refused, the answer had no text, the JSON was the wrong shape, a phrase was over the word budget, or the provider
 * reported no model version. Only the reason and the provider's numeric status are recorded — never a body, a phrase
 * or the transcript.
 */
export type CoachingFailureReason =
  | 'provider_http_4xx'
  | 'provider_http_5xx'
  | 'provider_transport'
  | 'provider_timeout'
  | 'missing_text'
  | 'invalid_shape'
  | 'over_character_ceiling'
  | 'missing_model_version'
  /** #1258 option A: the caller went away during an attempt or a wait. No further attempt, nothing persisted. */
  | 'request_cancelled'
  /** #1258 (PM 6203482045): an answer ARRIVED (its status is recorded) but its body could not be parsed. Retryable. */
  | 'provider_malformed_response';

const DIAGNOSTIC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_MODEL_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const CLIENT_RELEASE_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const DIAGNOSTIC_REASONS = new Set([
  'none', 'invalid_request', 'auth_failed', 'profile_unavailable', 'session_not_found', 'product_mismatch',
  'focus_context_unavailable', 'focus_results_pending', 'transcript_unavailable', 'product_unknown', 'service_configuration',
  'entitlement_unavailable', 'access_denied', 'quota_unavailable', 'quota_exceeded', 'provider_http_4xx',
  'provider_http_5xx', 'provider_transport', 'provider_timeout', 'missing_text', 'invalid_shape',
  'over_character_ceiling', 'missing_model_version', 'authority_unverified', 'persist_failed', 'internal_error',
  'request_cancelled', 'provider_malformed_response',
]);

type DiagnosticSource = 'fresh' | 'cache' | 'unknown';
type DiagnosticPhase = 'request' | 'auth' | 'session' | 'focus' | 'cache' | 'entitlement' | 'quota' | 'provider' | 'persist' | 'complete';

function closedDiagnosticReason(body: Record<string, unknown>, status: number, phase: DiagnosticPhase): string {
  const candidate = typeof body.reason === 'string' ? body.reason : typeof body.code === 'string' ? body.code : '';
  if (DIAGNOSTIC_REASONS.has(candidate)) return candidate;
  if (status >= 200 && status < 300) return 'none';
  if (status === 401) return 'auth_failed';
  if (status === 400) return 'invalid_request';
  if (status === 403) return 'access_denied';
  if (status === 404) return 'session_not_found';
  if (status === 409) return 'transcript_unavailable';
  if (status === 429) return 'quota_exceeded';
  if (status === 503) {
    if (phase === 'auth') return 'profile_unavailable';
    if (phase === 'focus') return 'focus_context_unavailable';
    if (phase === 'entitlement') return 'entitlement_unavailable';
    if (phase === 'quota') return 'quota_unavailable';
    if (phase === 'persist') return 'persist_failed';
  }
  return 'internal_error';
}

/** Classify a provider answer's text: the parsed pair, or the reason it is unusable. The size ceiling is checked last. */
export function classifyGeneratedSuggestions(rawText: unknown): { suggestions: AISuggestions } | { reason: CoachingFailureReason } {
  if (typeof rawText !== 'string' || !rawText.trim()) return { reason: 'missing_text' };
  if (!parseSuggestions(rawText)) return { reason: 'invalid_shape' };
  const suggestions = parseSuggestions(rawText, { enforceCharacterCeiling: true });
  return suggestions ? { suggestions } : { reason: 'over_character_ceiling' };
}

/**
 * #1258 (PO 2026-10-02) — a phrase that only restates a measured number ("Your pace was 148 words per minute",
 * "You used 4 fillers") instead of saying what to do. A QUALITY flag, recorded; never a reason to withhold coaching.
 * A recital is a metric statement with almost nothing else in the phrase.
 */
const METRIC_STATEMENT = new RegExp(
  [
    String.raw`\b(?:your\s+)?(?:wpm|words per minute|pace|speaking rate|speed|clarity(?:\s+score)?)\s+(?:was|is|were|of|at|hit)\s+(?:about\s+)?\d+(?:\.\d+)?\s*(?:wpm|words per minute|%|percent)?`,
    String.raw`\byou\s+(?:used|said|had)\s+\d+\s+(?:filler\s+words?|fillers?|ums?|uhs?|ahs?)\b`,
    String.raw`\b\d+\s+(?:filler\s+words?|fillers?|ums?|uhs?|ahs?)\b`,
  ].join('|'),
  'i',
);
export function isMetricRecital(phrase: string): boolean {
  const match = METRIC_STATEMENT.exec(phrase);
  if (!match) return false;
  const rest = (phrase.slice(0, match.index) + ' ' + phrase.slice(match.index + match[0].length)).replace(/[^A-Za-z']+/g, ' ');
  return countWords(rest) <= 2;
}

/** Content-free quality measurement of a served pair: counts and flags only, never the phrases. */
export function measureCoachingQuality(s: AISuggestions): {
  what_worked_words: number; next_step_words: number; within_target: boolean; metric_recital: boolean;
} {
  const what_worked_words = countWords(s.what_worked);
  const next_step_words = countWords(s.what_to_try_next);
  return {
    what_worked_words,
    next_step_words,
    within_target: what_worked_words >= COACHING_WORD_TARGET_MIN.what_worked && what_worked_words <= COACHING_WORD_TARGET.what_worked
      && next_step_words >= COACHING_WORD_TARGET_MIN.what_to_try_next && next_step_words <= COACHING_WORD_TARGET.what_to_try_next,
    metric_recital: isMetricRecital(s.what_worked) || isMetricRecital(s.what_to_try_next),
  };
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
/**
 * #1258 (PM 5952231855) — THE COACHING INPUT CONTRACT: only the reliable signals.
 *
 * Open Mic: the finalized transcript (sent separately) + finalized filler counts + WPM. Focus Points: the transcript +
 * the Focus Points results (`buildFocusCoachingText`) + AT MOST ONE delivery signal - the one the product's own saved
 * next action for this take is about (`next_action_signal.metric`: `filler_rate` -> fillers, `wpm` -> pace); any other
 * next action means no delivery signal, and the Focus evidence leads.
 *
 * NOT sent as coaching signals: clarity score (a composite of the same delivery evidence - it would double-count),
 * raw pause metrics (not yet validated for coaching), total words and duration (WPM already carries them).
 */
export function buildDeliverySignals(session: SessionEvidence, focusContext: FocusContext): string {
  // #1258: saves write `filler_counts` and strip `filler_words`; the legacy field is only a fallback for older rows.
  const fillerEvidence = session.filler_counts ?? session.filler_words;
  const fillers = `- Filler Words: ${fillerEvidence == null ? 'N/A' : JSON.stringify(fillerEvidence)}`;
  const pace = `- Words Per Minute (WPM): ${session.wpm ?? 'N/A'}`;
  if (focusContext.kind !== 'focus') {
    return `
      Delivery signals:
      ${pace}
      ${fillers}
    `;
  }
  const metric = (session.next_action_signal as { metric?: unknown } | null | undefined)?.metric;
  const chosen = metric === 'filler_rate' ? fillers : metric === 'wpm' ? pace : null;
  return chosen
    ? `
      Delivery signal (the one most actionable for this take):
      ${chosen}
    `
    : `
      Delivery signals: none material for this take - coach from the Focus Points results.
    `;
}

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
  const startedAt = performance.now();
  let requestInput: Record<string, unknown> = {};
  try {
    const value: unknown = await req.clone().json();
    if (value && typeof value === 'object' && !Array.isArray(value)) requestInput = value as Record<string, unknown>;
  } catch {
    // The request is still handled below as invalid; diagnostics never include parse error text/body.
  }
  const diagnosticRequestId = typeof requestInput.diagnostic_request_id === 'string'
    && DIAGNOSTIC_UUID.test(requestInput.diagnostic_request_id)
    ? requestInput.diagnostic_request_id : crypto.randomUUID();
  const diagnosticAttemptId = typeof requestInput.diagnostic_attempt_id === 'string'
    && DIAGNOSTIC_UUID.test(requestInput.diagnostic_attempt_id)
    ? requestInput.diagnostic_attempt_id : crypto.randomUUID();
  const clientAttempt = Number.isInteger(requestInput.client_attempt)
    && Number(requestInput.client_attempt) >= 1 && Number(requestInput.client_attempt) <= 2
    ? Number(requestInput.client_attempt) : null;
  const clientReleaseId = typeof requestInput.client_release_id === 'string'
    && CLIENT_RELEASE_ID.test(requestInput.client_release_id) ? requestInput.client_release_id : null;
  let diagnosticPhase: DiagnosticPhase = 'request';
  let diagnosticSource: DiagnosticSource = 'unknown';
  let diagnosticProduct: SessionProduct | 'unknown' = asProduct(requestInput.product) ?? 'unknown';
  let hasSession = typeof requestInput.sessionId === 'string' && DIAGNOSTIC_UUID.test(requestInput.sessionId);
  let observedProviderModel: string | null = null;
  let providerAttempts = 0;
  let providerDurationMs = 0;
  let providerStatus: number | null = null;
  // #1258 (PO 2026-10-12): the provider's own closed codes for the last attempt, and every attempt's outcome.
  let providerErrorCodes: ProviderErrorCodes | null = null;
  let providerAnswerCodes: ProviderAnswerCodes | null = null;
  const providerAttemptLog: Array<{ reason: string; status: number | null; ms: number }> = [];
  // #1258 option A: content-free retry facts — never the header's raw value.
  let providerWaitMs = 0;
  let retryAfterPresent = false;
  let retryAfterMalformed = false;
  let retryAfterS: number | null = null;
  let stoppedOverBudget = false;
  let promptSha256: string | null = null;
  // Response-only binding for the private evidence collector. Do not include this in the content-free
  // diagnostic log or any telemetry: it is a stable pseudonymous link to the selected authenticated row.
  let sessionBindingSha256: string | null = null;
  // A durable account admission precedes quota/provider work. Unknown external or commit
  // outcomes remain fenced; a disconnected browser is not proof that work settled.
  let coachingAdmission: { p_user_id: string; p_session_id: string; p_operation_id: string } | null = null;
  let coachingPersisted = false;
  let coachingOutcomeUnknown = false;
  const finish = (payload: Record<string, unknown>, status: number): Response => {
    const rawReason = closedDiagnosticReason(payload, status, diagnosticPhase);
    const diagnostic = {
      schema_version: 'coaching_diagnostic_v1',
      request_id: diagnosticRequestId,
      attempt_id: diagnosticAttemptId,
      client_attempt: clientAttempt,
      phase: diagnosticPhase,
      outcome: status === 425 ? 'retrying' : status >= 200 && status < 300 ? 'success' : 'failure',
      reason: rawReason,
      status,
      provider_status: providerStatus,
      provider: providerAttempts > 0 || (diagnosticSource === 'cache' && observedProviderModel) ? 'google_gemini' : 'none',
      configured_model: coachingContract.model,
      observed_model: observedProviderModel,
      source: diagnosticSource,
      provider_attempts: providerAttempts,
      retry_count: Math.max(0, providerAttempts - 1),
      provider_duration_ms: Math.min(600_000, Math.max(0, Math.round(providerDurationMs))),
      total_duration_ms: Math.min(600_000, Math.max(0, Math.round(performance.now() - startedAt))),
      prompt_sha256: promptSha256,
      product: diagnosticProduct,
      has_session: hasSession,
      client_release_id: clientReleaseId,
      // #1258 (PO 2026-10-12): the provider's own closed codes (last attempt) and each attempt's outcome. Flat scalars,
      // so the client's telemetry allowlist can carry every field (nested values are dropped there).
      provider_error_status: providerErrorCodes?.error_status ?? null,
      provider_error_reason: providerErrorCodes?.error_reason ?? null,
      provider_finish_reason: providerAnswerCodes?.finish_reason ?? null,
      provider_block_reason: providerAnswerCodes?.block_reason ?? null,
      provider_prompt_tokens: providerAnswerCodes?.prompt_tokens ?? null,
      provider_output_tokens: providerAnswerCodes?.output_tokens ?? null,
      provider_thinking_tokens: providerAnswerCodes?.thinking_tokens ?? null,
      provider_total_tokens: providerAnswerCodes?.total_tokens ?? null,
      attempt_1_reason: providerAttemptLog[0]?.reason ?? null,
      attempt_1_status: providerAttemptLog[0]?.status ?? null,
      attempt_1_ms: providerAttemptLog[0]?.ms ?? null,
      attempt_2_reason: providerAttemptLog[1]?.reason ?? null,
      attempt_2_status: providerAttemptLog[1]?.status ?? null,
      attempt_2_ms: providerAttemptLog[1]?.ms ?? null,
      attempt_3_reason: providerAttemptLog[2]?.reason ?? null,
      attempt_3_status: providerAttemptLog[2]?.status ?? null,
      attempt_3_ms: providerAttemptLog[2]?.ms ?? null,
      provider_wait_ms_total: Math.min(600_000, Math.max(0, Math.round(providerWaitMs))),
      retry_after_present: retryAfterPresent,
      retry_after_malformed: retryAfterMalformed,
      retry_after_s: retryAfterS,
      stopped_over_budget: stoppedOverBudget,
    };
    // Structured, content-free log line is the fallback diagnostic path when Sentry is absent.
    console.info('AI_COACHING_DIAGNOSTIC', JSON.stringify(diagnostic));
    const responseDiagnostic = sessionBindingSha256
      ? { ...diagnostic, session_binding_sha256: sessionBindingSha256 }
      : diagnostic;
    return new Response(JSON.stringify({ ...payload, diagnostics: responseDiagnostic }), {
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      status,
    });
  };

  try {
    diagnosticPhase = 'auth';
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
        return finish({ error: 'Authentication failed' }, 401);
      }
      // #1473 — 42501: the caller's role lacks the privilege to read its own profile. That is a SERVICE CONFIGURATION
      // failure, not the user's account and not a transient outage, so it gets one closed, allowlisted code the client
      // can act on. The body names no table, role or database detail, and nothing past this point (quota, provider,
      // persistence) runs. Only this code maps here: PGRST116 stays authentication, and anything else — including a
      // forged-token PGRST301 — stays the generic fail-closed 500.
      if (profileError.code === '42501') {
        console.error('Profile read refused: service configuration (42501).');
        return finish({
          error: 'AI coaching is unavailable right now.',
          code: 'service_configuration',
        }, 503);
      }
      console.error('Profile fetch error:', profileError);
      return finish({ error: 'Failed to fetch user profile' }, 500);
    }

    const body = requestInput as { sessionId?: unknown; product?: unknown; accepted_coaching_versions?: unknown };
    const sessionId = body.sessionId;
    hasSession = typeof sessionId === 'string' && DIAGNOSTIC_UUID.test(sessionId);
    // #1258 / #1538 (PM RETURN 5849473254): the page's product is only a CONSISTENCY ASSERTION. The server-owned
    // `sessions.product` marker decides; the request can never downgrade or supply it.
    const requestedProduct = asProduct(body.product);
    const focusCapable = acceptsFocusCoaching(body.accepted_coaching_versions);
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return finish({ error: 'Session ID is required' }, 400);
    }

    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id ?? null;
    if (userError || !userId) {
      return finish({ error: 'Authentication failed' }, 401);
    }

    // The saved, RLS-owned session is the only coaching evidence authority. Caller-supplied
    // transcript/metrics are deliberately ignored so one session cannot be relabelled as another.
    const readSession = (columns: string) => supabaseClient
      .from('sessions')
      .select(columns)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();
    let { data: sessionData, error: sessionError } = await readSession(`${SESSION_EVIDENCE_COLUMNS}, product`);
    if (isMissingProductColumn(sessionError as { code?: string; message?: string } | null)) {
      ({ data: sessionData, error: sessionError } = await readSession(SESSION_EVIDENCE_COLUMNS));
    }

    if (sessionError || !sessionData) {
      return finish({ error: 'Session was not found' }, 404);
    }

    // Bind the response digest to the authenticated owner and the exact selected session. This remains
    // response-only: the raw IDs and their stable digest are excluded from logs and telemetry.
    sessionBindingSha256 = [...new Uint8Array(await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(JSON.stringify({ user_id: userId, session_id: sessionId })),
    ))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

    const session = sessionData as unknown as SessionEvidence;
    diagnosticProduct = asProduct(session.product) ?? requestedProduct ?? 'unknown';

    // #1538 — THE STORED MARKER IS THE PRODUCT AUTHORITY.
    //  - open_mic: never reads the objective tables, so an objective-table failure cannot break Open Mic coaching;
    //  - focus_points: saved Focus results are required before any cache replay or generation (425/503 otherwise);
    //  - NULL (a row created before the marker): decided only by durable Focus evidence, never by the caller's hint or
    //    by an absence, and no generic pair is ever generated and cached for it.
    // A request naming a different product than the stored one fails closed before any cache, quota or provider work.
    // Product refusals are 422, never 409: the client reads 409 as "this saved session has no transcript" (#1538
    // Codex P2 r4117187862), which would be false here; 422 is its truthful, terminal "unavailable".
    const marker = asProduct(session.product);
    if (marker && requestedProduct && marker !== requestedProduct) {
      return finish({ error: 'This session was saved as a different product.', code: 'product_mismatch' }, 422);
    }
    // Legacy rows keep the strictness the page's statement already had: it can only make the request stricter.
    const expectsFocusPoints = marker ? marker === 'focus_points' : requestedProduct === 'focus_points';

    // #1258 (PM 2026-09-26) — FOCUS RESULTS ARE CHECKED BEFORE ANY CACHED PAIR IS RETURNED AS FOCUS COACHING. A pair
    // cached for this session is replayed to a Focus Points request only once its saved point results exist; until
    // then the request is refused 425 (nothing spent, nothing replayed), exactly as a first request would be.
    const focusResultsUnready = (context: FocusContext) =>
      context.kind === 'pending' || (expectsFocusPoints && context.kind !== 'focus');
    const refuseFocusRead = (context: FocusContext): Response | null => {
      if (context.kind === 'error') {
        return finish({ error: 'AI coaching is unavailable right now. Please try again.' }, 503);
      }
      if (focusResultsUnready(context)) {
        return finish({ error: 'Focus Points results are not ready yet. Please try again.', code: 'focus_results_pending' }, 425);
      }
      return null;
    };
    let focusContext: FocusContext | null = marker === 'open_mic' ? { kind: 'none' } : null;
    // An unmarked row asserted as Open Mic is checked against its durable Focus evidence BEFORE any cache replay:
    // evidence that it was a Focus take makes the assertion a mismatch (PM RETURN 5850253992), never Focus coaching
    // handed to an Open Mic caller.
    if (expectsFocusPoints || (!marker && requestedProduct === 'open_mic')) {
      focusContext = await loadFocusContext(supabaseClient, sessionId);
      const refused = refuseFocusRead(focusContext);
      if (refused) return refused;
      if (!marker && requestedProduct === 'open_mic' && focusContext.kind === 'focus') {
        return finish({ error: 'This session was saved as a different product.', code: 'product_mismatch' }, 422);
      }
    }

    let cachedSuggestions = session.ai_suggestions
      ? parseSuggestions(JSON.stringify(session.ai_suggestions))
      : null;
    // #1538 (Codex P1 r4117321439, PM RETURN 5860537369): a cached pair replays as Focus coaching only when its version
    // proves it was generated from the saved Focus results. A generic v1 pair on a Focus take (written before this
    // change) is unproven: it is regenerated once below and overwritten through the existing authority RPC. An unmarked
    // legacy row's Focus identity comes only from its durable evidence, read here before any replay.
    if (cachedSuggestions && cachedSuggestions.version === 'gemini_coaching_v1' && marker !== 'open_mic') {
      if (!focusContext) {
        diagnosticPhase = 'focus';
        focusContext = await loadFocusContext(supabaseClient, sessionId);
        const refused = refuseFocusRead(focusContext);
        if (refused) return refused;
      }
      if (focusContext.kind === 'focus') cachedSuggestions = null;
    }
    if (cachedSuggestions) {
      diagnosticPhase = 'cache';
      diagnosticSource = 'cache';
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
      // Best-effort read of the existing immutable authority receipt. Cache replay makes no provider call, so its
      // original model is named only when the server-owned saved value still matches that receipt.
      try {
        const { data: rows, error } = await createServiceRoleSupabase().rpc('read_ai_suggestion_authority_v1', {
          p_session_ids: [sessionId],
        });
        const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
        if (!error && row?.session_id === sessionId && row?.user_id === userId
          && row?.provider === 'google_gemini' && row?.provider_request_made === true
          && typeof row?.receipt_suggestion_sha256 === 'string' && SHA256_HEX.test(row.receipt_suggestion_sha256)
          && typeof row?.current_suggestion_sha256 === 'string' && SHA256_HEX.test(row.current_suggestion_sha256)
          && row?.current_suggestion_sha256 === row?.receipt_suggestion_sha256
          && typeof row?.model === 'string' && SAFE_MODEL_ID.test(row.model)) {
          observedProviderModel = row.model;
        }
      } catch {
        // Keep cached coaching readable; missing authority is represented as null model provenance.
      }
      return finish({ suggestions: forClient(cachedSuggestions, focusCapable) }, 200);
    }

    diagnosticPhase = 'session';

    if (session.transcript_state !== 'available' || typeof session.transcript !== 'string' || !session.transcript.trim()) {
      return finish({ error: 'AI coaching requires an available saved transcript' }, 409);
    }

    // #1258 — the session's saved Focus Points results, read BEFORE entitlement and quota so a refusal spends nothing.
    // A failed read, or a Focus Points take whose results are not saved yet, must never become generic coaching:
    // the answer would be cached on the row and the person could never get coaching about their points. `pending` is
    // refused even when the request names no product (a tab loaded before this deploy), so no generic pair can be
    // cached for a Focus take and later replayed as its Focus coaching.
    if (!focusContext) {
      diagnosticPhase = 'focus';
      focusContext = await loadFocusContext(supabaseClient, sessionId);
      const refused = refuseFocusRead(focusContext);
      if (refused) return refused;
    }
    // A legacy (unmarked) row with no durable Focus evidence is of UNKNOWN product: generating would guess Open Mic
    // from an absence and cache that guess on the row. Refused before entitlement, quota and provider work.
    if (!marker && focusContext.kind === 'none') {
      return finish({ error: 'Coaching isn’t available for this older session.', code: 'product_unknown' }, 422);
    }

    diagnosticPhase = 'entitlement';
    // Generating new coaching is an analysis operation, so it uses the same server-authoritative
    // commercial entitlement seam as recording. A marked active trial and a paid subscription both
    // pass; an expired/unpaid account fails closed. Cached coaching above remains readable after expiry.
    const { data: entitlement, error: entitlementError } = await supabaseClient.rpc('check_usage_limit');
    if (entitlementError) {
      console.error('Entitlement check failed:', entitlementError);
      return finish({ error: 'Unable to verify analysis access' }, 503);
    }
    if (entitlement?.can_start !== true || entitlement?.is_pro !== true) {
      return finish({ error: 'Trial has ended' }, 403);
    }

    const transcriptForPrompt = session.transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${session.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for coaching request length.]`
      : session.transcript;

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set.');
      return finish({ error: 'AI coaching is unavailable right now. Please try again.', code: 'service_configuration' }, 503);
    }

    const operationIdentity = { p_user_id: userId, p_session_id: sessionId, p_operation_id: crypto.randomUUID() };
    const { data: admission, error: admissionError } = await createServiceRoleSupabase().rpc(
      'begin_account_coaching_v1', operationIdentity,
    );
    if (admissionError || admission?.admitted !== true || admission.operationId !== operationIdentity.p_operation_id) {
      if (!admissionError && admission?.admitted === false && admission.reason === 'account_closure_pending') {
        return finish({ error: 'Account closure is pending. New coaching is unavailable.', code: 'account_closure_pending', reason: 'access_denied' }, 423);
      }
      return finish({ error: 'Unable to verify account access for new coaching. Please try again.', code: 'account_admission_unverified', reason: 'authority_unverified' }, 503);
    }
    coachingAdmission = operationIdentity;

    diagnosticPhase = 'quota';
    const { data: quota, error: quotaError } = await supabaseClient.rpc('consume_ai_suggestion_quota', {
      p_limit: AI_SUGGESTION_DAILY_LIMIT,
    });

    if (quotaError) {
      console.error('AI suggestion quota check failed:', quotaError);
      return finish({ error: 'Unable to verify AI coaching quota. Please try again.' }, 503);
    }

    const quotaResult = quota as QuotaResult | null;
    if (quotaResult && quotaResult.allowed === false) {
      return finish({
        error: 'Daily AI coaching limit reached. Try again tomorrow.',
        remaining: quotaResult.remaining ?? 0,
        limit: quotaResult.limit ?? AI_SUGGESTION_DAILY_LIMIT,
      }, 429);
    }

    const metricsText = buildDeliverySignals(session, focusContext) + buildFocusCoachingText(focusContext);

    const prompt = buildCoachingPrompt(transcriptForPrompt, metricsText);

    promptSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt)))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    diagnosticPhase = 'provider';
    diagnosticSource = 'fresh';

    let suggestions: AISuggestions | null = null;
    let failureReason: CoachingFailureReason | null = null;

    // #1258 option A: ONE budget, started immediately before attempt 1, covering every attempt and every wait.
    const retryRuntime = providerRetryHooks.runtime;
    const budgetStartedAt = retryRuntime.now();
    const callerSignal = req.signal;
    let callerAborted = false;

    for (let providerAttempt = 1; providerAttempt <= AI_PROVIDER_ATTEMPTS; providerAttempt += 1) {
      providerAttempts = providerAttempt;
      // Only a failure in the retry set earns another attempt (`providerRetry.ts`). Set where the failure is known.
      let providerFailureIsRetryable = false;
      let retryAfter: RetryAfter = { kind: 'absent' };
      // This attempt's own timeout, kept so its abort can be told apart from the caller's and from a malformed body.
      const attemptTimeout = retryRuntime.timeout(attemptTimeoutMs(retryRuntime.now() - budgetStartedAt));
      // Each attempt states its own outcome; the reason reported is the last attempt's.
      suggestions = null;
      failureReason = null;
      providerStatus = null;
      providerErrorCodes = null;
      providerAnswerCodes = null;
      const providerStartedAt = performance.now();
      try {
        const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The caller's own abort and this attempt's timeout, composed — and told apart below by which one fired.
          signal: AbortSignal.any([callerSignal, attemptTimeout]),
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: GEMINI_GENERATION_CONFIG,
          }),
        });
        // #1258 (Codex P2 r4288823216): a received answer's status is known the moment fetch resolves, before either
        // body is read, so a malformed or truncated body still reports the status that actually arrived.
        providerStatus = geminiResponse.status;

        if (!geminiResponse.ok) {
          // Header only, read for the wait decision and never logged or returned in raw form.
          retryAfter = parseRetryAfter(geminiResponse.headers.get('retry-after'), retryRuntime.wallNow());
          // #1258 (PM 5953504835): the provider's error body can echo anything, so it is never logged or returned.
          // PO 2026-10-12: it is DECODED instead — only `error.status` and the ErrorInfo `reason`, each kept only when
          // it belongs to its closed vocabulary (providerDecode.ts); the message and every other field are not read.
          providerErrorCodes = decodeProviderError(await readBoundedBody(geminiResponse));
          console.error('Gemini API request failed.', JSON.stringify({
            status: geminiResponse.status, attempt: providerAttempt,
            error_status: providerErrorCodes.error_status, error_reason: providerErrorCodes.error_reason,
          }));
          providerFailureIsRetryable = isRetryableProviderStatus(geminiResponse.status);
          failureReason = geminiResponse.status >= 500 ? 'provider_http_5xx' : 'provider_http_4xx';
        } else {
          // #1258 (PM 6203482045): a received answer whose body is malformed or truncated is NOT a transport failure — its
          // status already arrived. Named for what it is; still retryable (a truncated body is typically transient).
          let responseData: Awaited<ReturnType<Response['json']>> | null = null;
          try {
            responseData = await geminiResponse.json();
          } catch {
            coachingOutcomeUnknown = true;
            if (callerSignal.aborted) {
              // PM 6206983551: the CALLER left while the received answer was being read — a cancellation, never a
              // retryable malformed answer. The received status stays in the attempt evidence.
              callerAborted = true;
              failureReason = 'request_cancelled';
            } else if (attemptTimeout.aborted) {
              // Codex P2 r4290479629: headers arrived, then the BODY stalled past this attempt's timeout — a provider
              // timeout, not a malformed answer. Retryable; the received status stays in the attempt evidence.
              providerFailureIsRetryable = true;
              failureReason = 'provider_timeout';
            } else {
              providerFailureIsRetryable = true;
              failureReason = 'provider_malformed_response';
            }
          }
          if (responseData !== null) {
            providerAnswerCodes = decodeProviderAnswer(responseData);
            const rawText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
            observedProviderModel = typeof responseData?.modelVersion === 'string'
              && /^[A-Za-z0-9._:-]{1,128}$/.test(responseData.modelVersion)
              ? responseData.modelVersion
              : null;
            // The model's FRESH answer — the one place the budget is enforced.
            const classified = classifyGeneratedSuggestions(rawText);
            if ('suggestions' in classified) suggestions = classified.suggestions;
            else failureReason = classified.reason;
            if (suggestions && !observedProviderModel) failureReason = 'missing_model_version';
          }
        }
      } catch (error) {
        coachingOutcomeUnknown = true;
        // #1258: the error NAME only. A fetch error's message can carry the request URL, and this URL carries the API key.
        const errorName = error instanceof Error ? error.name : 'unknown';
        console.error('Gemini API request failed.', JSON.stringify({ error: errorName, attempt: providerAttempt }));
        if (callerSignal.aborted) {
          // The CALLER went away — not a provider timeout, and not retryable: no one is waiting for the answer.
          callerAborted = true;
          failureReason = 'request_cancelled';
        } else {
          const timedOut = errorName === 'TimeoutError' || errorName === 'AbortError';
          providerFailureIsRetryable = true;
          failureReason = timedOut ? 'provider_timeout' : 'provider_transport';
        }
      } finally {
        const attemptMs = Math.max(0, performance.now() - providerStartedAt);
        providerDurationMs += attemptMs;
        providerAttemptLog.push({
          reason: failureReason ?? (suggestions ? 'none' : 'invalid_shape'),
          status: providerStatus,
          ms: Math.min(600_000, Math.round(attemptMs)),
        });
      }

      // A complete answer ends the loop. So does a failure a second ask cannot change.
      if (suggestions && observedProviderModel) break;
      if (!providerFailureIsRetryable) break;

      if (retryAfter.kind !== 'absent') {
        retryAfterPresent = true;
        retryAfterMalformed = retryAfter.kind === 'malformed';
        retryAfterS = retryAfter.kind === 'valid' ? Math.min(60, Math.round(retryAfter.ms / 1000)) : null;
      }
      const step = planNextAttempt({
        attemptsDone: providerAttempt,
        elapsedMs: retryRuntime.now() - budgetStartedAt,
        retryAfter,
        random: retryRuntime.random(),
      });
      // Out of attempts or budget: stop WITHOUT sleeping, keeping the last attempt's failure.
      if (step.kind === 'stop') {
        stoppedOverBudget = step.why !== 'attempt_cap';
        break;
      }
      if (step.ms > 0) {
        // Codex P2 r4290479635: the wait actually spent (a late wake included), not the wait requested.
        const sleepStartedAt = retryRuntime.now();
        const slept = await retryRuntime.sleep(step.ms, callerSignal);
        providerWaitMs += Math.max(0, retryRuntime.now() - sleepStartedAt);
        if (!slept) {
          callerAborted = true;
          failureReason = 'request_cancelled';
          break;
        }
      }
      // PM 6206983551: re-admit with the FRESH remaining time — a late wake can leave less than an attempt needs, or none.
      // Stop without fetching, keeping the prior failure. A caller who left during the wait is checked here too.
      if (callerSignal.aborted) {
        callerAborted = true;
        failureReason = 'request_cancelled';
        break;
      }
      if (!canAdmitAttempt(retryRuntime.now() - budgetStartedAt)) {
        stoppedOverBudget = true;
        break;
      }
    }

    // Do not start more provider work after cancellation. A fully received valid answer,
    // however, completes its already-admitted save even if the browser has since left.
    if ((callerAborted || callerSignal.aborted) && (!suggestions || !observedProviderModel)) {
      return finish({ error: 'AI coaching request was cancelled.', reason: 'request_cancelled' }, 499);
    }

    // #1538: a pair generated from the saved Focus results carries that provenance in its version.
    if (suggestions) {
      suggestions = { ...suggestions, version: focusContext?.kind === 'focus' ? 'gemini_coaching_focus_v1' : 'gemini_coaching_v1' };
    }

    if (!suggestions || !observedProviderModel) {
      const reason: CoachingFailureReason = failureReason ?? (suggestions ? 'missing_model_version' : 'invalid_shape');
      // Content-free: the closed reason and the provider's numeric status only (#1258).
      console.error('Gemini response did not contain valid suggestions JSON.', JSON.stringify({
        reason, providerStatus,
        error_status: providerErrorCodes?.error_status ?? null, error_reason: providerErrorCodes?.error_reason ?? null,
        finish_reason: providerAnswerCodes?.finish_reason ?? null, block_reason: providerAnswerCodes?.block_reason ?? null,
        attempts: providerAttemptLog.map((a) => `${a.reason}:${a.status ?? 'none'}:${a.ms}`).join(','),
      }));
      return finish({ error: 'AI coaching could not be generated. Please try again.', reason }, 502);
    }

    const quotaLimit = quotaResult?.limit;
    const quotaRequestNumber = quotaResult?.used;
    if (!Number.isInteger(quotaLimit) || !Number.isInteger(quotaRequestNumber)
      || Number(quotaLimit) <= 0 || Number(quotaRequestNumber) <= 0
      || Number(quotaRequestNumber) > Number(quotaLimit)) {
      console.error('AI suggestion quota receipt was incomplete.');
      return finish({ error: 'AI coaching authority could not be verified. Please try again.', code: 'authority_unverified' }, 503);
    }

    diagnosticPhase = 'persist';
    // Persist the coaching value and its provider/quota authority in one service-role transaction.
    // The browser's authenticated client cannot execute this RPC or write the receipt table.
    // A lost commit reply is unknown until the atomic database operation can be reconciled.
    const providerSettled = !coachingOutcomeUnknown;
    coachingOutcomeUnknown = true;
    const { data: savedValue, error: updateError } = await createServiceRoleSupabase().rpc(
      'persist_account_coaching_v1',
      {
        p_operation_id: coachingAdmission.p_operation_id,
        p_provider_settled: providerSettled,
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

    const savedSuggestions = !updateError && savedValue
      ? parseSuggestions(JSON.stringify(savedValue))
      : null;
    if (!savedSuggestions || JSON.stringify(savedSuggestions) !== JSON.stringify(suggestions)) {
      console.error('Failed to save and verify AI suggestions:', updateError);
      return finish({ error: 'AI coaching could not be saved. Please try again.', code: 'persist_failed' }, 503);
    }
    coachingPersisted = true;

    // #1258 (PO 2026-10-02): every SERVED generation is measured, content-free — counts and flags, never phrases.
    // Emitted only here, after save verification (Codex r4189408877): a generation that ends in 503 was never served,
    // so it must not enter the served-answer quality measurement.
    console.log('AI coaching quality', JSON.stringify(measureCoachingQuality(savedSuggestions)));
    diagnosticPhase = 'complete';
    return finish({ suggestions: forClient(savedSuggestions, focusCapable) }, 200);

  } catch (error) {
    console.error('Error getting AI suggestions:', error);
    return finish({ error: 'Failed to get AI suggestions. Please try again.' }, 500);
  } finally {
    if (coachingAdmission && !coachingPersisted) {
      try {
        const { data, error } = await createServiceRoleSupabase().rpc('finish_account_coaching_failure_v1', {
          ...coachingAdmission,
          p_outcome: coachingOutcomeUnknown ? 'unknown' : 'refused',
        });
        if (error || data !== true) console.error('Account coaching settlement remains unverified.');
      } catch {
        // The durable admission remains unsettled. Never turn a failed settlement write into permission to delete.
        console.error('Account coaching settlement remains unverified.');
      }
    }
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
