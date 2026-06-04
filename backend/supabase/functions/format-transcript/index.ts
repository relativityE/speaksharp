/**
 * ============================================================================
 * format-transcript — API-backed (Native/Cloud) transcript formatter backend
 * ============================================================================
 *
 * Backend for the existing frontend seam in
 *   frontend/src/services/transcription/modes/nativeGeminiFormatter.ts
 *
 * It restores SENTENCE PUNCTUATION + sentence-start CASING on a SAVED transcript
 * and returns it. It MUST NOT add / remove / reorder / "correct" words or drop
 * filler words. A server-side word-preservation check enforces this; if the model
 * changes any word the request is rejected (FORMATTER_WORDS_CHANGED) and the
 * frontend seam keeps the raw transcript.
 *
 * SCOPE (hard rules):
 *  - API-backed formatter = Native / Cloud path only.
 *  - Private formatter = local/browser model ONLY. This backend HARD-REJECTS
 *    engine === 'private' with PRIVATE_FORMATTER_NOT_ALLOWED. No transcript that
 *    comes through the Private path may ever reach this function.
 *  - Cloud STT already has provider punctuation; it may call this for casing/cleanup
 *    but does not depend on it.
 *
 * PRIVACY / LOGGING (hard rules):
 *  - NEVER log transcript text. Not raw, not formatted, not the prompt.
 *  - Logs contain only metadata: counts, latency, provider status, error code,
 *    a sha256(userId) hash, a requestId, and sha256(normalizedTranscript)[:12]
 *    purely for debug correlation.
 *  - Error responses NEVER include transcript text.
 *
 * ⚠️ IDE LINT NOTE: "Cannot find name 'Deno'" is a FALSE POSITIVE. This file runs
 * in Supabase Edge Functions (Deno runtime), not Node.js.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders as buildCorsHeaders } from '../_shared/cors.ts';

// --- Configuration ----------------------------------------------------------
const PROVIDER = 'gemini';
// Model is env-overridable (Supabase secret) so it can be swapped with NO code redeploy.
// Default = gemini-2.5-flash-lite (fastest 2.5). History: gemini-3-flash-preview HUNG
// (~15.9s -> 504); gemini-2.0-flash deprecated; gemini-3.5-flash RAN and was word-preserving
// in the 2026-06-03 Native real-mic proof but at latencyMs=15154 — far over the funnel target.
// Per that proof we move the default to the fastest 2.5 model. The CLIENT also enforces a
// ~4s budget (FORMATTER_LATENCY_BUDGET_MS) so a slow provider falls back to raw rather than
// blocking Stop. The 28s PROVIDER_TIMEOUT_MS below is a DIAGNOSTIC CEILING only.
const FORMATTER_MODEL = Deno.env.get('FORMATTER_MODEL') || 'gemini-2.5-flash-lite';
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${FORMATTER_MODEL}:generateContent`;
export const FORMATTER_VERSION = 'format-transcript@1.0.0';
const MAX_TRANSCRIPT_CHARS = 8000;
// Raised from 15s and env-overridable. A flash model on a short transcript should
// return in 1-3s; the 2026-06 Native proof saw ~15.9s -> 504 (request aborted, which
// HIDES providerStatus). A higher cap lets a slow-but-working call complete OR surface
// the real Gemini status (providerStatus/providerStatusEnum) instead of a blind timeout.
const PROVIDER_TIMEOUT_MS = Number(Deno.env.get('FORMATTER_TIMEOUT_MS')) || 28_000;
// Per-user daily formatter call cap (enforced by the consume_formatter_quota RPC).
// Env-overridable so ops can tune the cost guard with no code redeploy.
const FORMATTER_DAILY_LIMIT = Number(Deno.env.get('FORMATTER_DAILY_LIMIT')) || 200;

/**
 * Default formatting instruction. MUST stay in sync with the frontend adapter's
 * NATIVE_FORMATTER_INSTRUCTION (nativeGeminiFormatter.ts). The frontend always
 * sends `instruction`; this is the server-side fallback / floor.
 */
const DEFAULT_INSTRUCTION = [
  'Restore sentence punctuation and sentence-start capitalization only.',
  'Do NOT add, remove, reorder, summarize, translate, or correct any words.',
  'Preserve filler words exactly as spoken: um, uh, like, you know, basically, literally.',
  'Return only the reformatted transcript text.',
].join(' ');

// Stable error codes. (code -> HTTP status)
export const ERROR_CODES = {
  METHOD_NOT_ALLOWED: 405,
  INVALID_JSON: 400,
  EMPTY_TRANSCRIPT: 400,
  TRANSCRIPT_TOO_LONG: 413,
  PRIVATE_FORMATTER_NOT_ALLOWED: 403,
  AUTH_REQUIRED: 401,
  QUOTA_EXCEEDED: 429,
  GEMINI_KEY_MISSING: 500,
  FORMATTER_PROVIDER_ERROR: 502,
  FORMATTER_PROVIDER_TIMEOUT: 504,
  FORMATTER_EMPTY_OUTPUT: 502,
  FORMATTER_WORDS_CHANGED: 422,
} as const;
export type FormatterErrorCode = keyof typeof ERROR_CODES;

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

// --- Helpers ----------------------------------------------------------------

/**
 * Word sequence used for the word-preservation check. Lowercases, drops
 * punctuation (keeping intra-word apostrophes), collapses whitespace, splits on
 * spaces. Filler words ("um", "uh", "like", ...) survive as ordinary words, so
 * dropping a filler is detected as a changed word sequence.
 */
export function wordSequence(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** True iff `formatted` has the exact same word sequence as `raw` (order-sensitive). */
export function isWordPreserving(raw: string, formatted: string): boolean {
  const a = wordSequence(raw);
  const b = wordSequence(formatted);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Strip markdown code fences / leading-trailing whitespace from a model reply. */
function cleanModelText(text: string): string {
  return text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Structured log. Callers pass ONLY whitelisted, non-transcript fields. This
 * function never receives transcript text by contract — keep it that way.
 */
function logEvent(
  level: 'info' | 'error',
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const payload = JSON.stringify({ fn: 'format-transcript', ...fields });
  if (level === 'error') console.error(payload);
  else console.log(payload);
}

interface ErrorBody {
  error: string;
  code: FormatterErrorCode;
  metadata?: Record<string, unknown>;
}

function errorResponse(
  code: FormatterErrorCode,
  message: string,
  responseHeaders: Record<string, string>,
  metadata?: Record<string, unknown>,
): Response {
  const body: ErrorBody = { error: message, code };
  if (metadata) body.metadata = metadata;
  return new Response(JSON.stringify(body), {
    headers: { ...responseHeaders, 'Content-Type': 'application/json' },
    status: ERROR_CODES[code],
  });
}

// --- Handler ----------------------------------------------------------------

export async function handler(req: Request, createSupabase: SupabaseClientFactory): Promise<Response> {
  const responseHeaders = buildCorsHeaders(req);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: responseHeaders });
  }

  // Method guard
  if (req.method !== 'POST') {
    logEvent('error', { requestId, code: 'METHOD_NOT_ALLOWED', method: req.method });
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', responseHeaders);
  }

  // Parse body
  let body: {
    transcript?: unknown;
    instruction?: unknown;
    engine?: unknown;
    sessionId?: unknown;
    runId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    logEvent('error', { requestId, code: 'INVALID_JSON' });
    return errorResponse('INVALID_JSON', 'Request body must be valid JSON.', responseHeaders);
  }

  const engine = typeof body.engine === 'string' ? body.engine : undefined;

  // PRIVACY GUARD — unconditional, before auth. Private must never use this backend.
  if (engine === 'private') {
    logEvent('error', { requestId, code: 'PRIVATE_FORMATTER_NOT_ALLOWED', engine });
    return errorResponse(
      'PRIVATE_FORMATTER_NOT_ALLOWED',
      'The API formatter must not be used for the Private engine. Private formatting must stay local.',
      responseHeaders,
    );
  }

  // Transcript presence / type
  const transcript = typeof body.transcript === 'string' ? body.transcript : '';
  if (!transcript.trim()) {
    logEvent('error', { requestId, code: 'EMPTY_TRANSCRIPT' });
    return errorResponse('EMPTY_TRANSCRIPT', 'A non-empty transcript string is required.', responseHeaders);
  }

  const inputChars = transcript.length;
  if (inputChars > MAX_TRANSCRIPT_CHARS) {
    logEvent('error', { requestId, code: 'TRANSCRIPT_TOO_LONG', inputChars });
    return errorResponse(
      'TRANSCRIPT_TOO_LONG',
      `Transcript exceeds the ${MAX_TRANSCRIPT_CHARS}-character formatting limit.`,
      responseHeaders,
    );
  }

  // sha256 hashes for debug correlation (NEVER the text itself)
  const transcriptHash = (await sha256Hex(wordSequence(transcript).join(' '))).slice(0, 12);

  // Auth
  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createSupabase(authHeader);
  let userIdHash = 'anonymous';
  try {
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    const userId = userData?.user?.id ?? null;
    if (userError || !userId) {
      logEvent('error', { requestId, code: 'AUTH_REQUIRED', transcriptHash });
      return errorResponse('AUTH_REQUIRED', 'Authentication is required.', responseHeaders);
    }
    userIdHash = (await sha256Hex(userId)).slice(0, 16);
  } catch {
    logEvent('error', { requestId, code: 'AUTH_REQUIRED', transcriptHash });
    return errorResponse('AUTH_REQUIRED', 'Authentication is required.', responseHeaders);
  }

  // Quota (optional, degrade-open). If the RPC is absent/errors, allow and log.
  if (typeof (supabaseClient as { rpc?: unknown }).rpc === 'function') {
    try {
      const { data: quota, error: quotaError } = await supabaseClient.rpc('consume_formatter_quota', {
        p_limit: FORMATTER_DAILY_LIMIT,
      });
      if (!quotaError && quota && (quota as { allowed?: boolean }).allowed === false) {
        logEvent('error', { requestId, userIdHash, code: 'QUOTA_EXCEEDED', transcriptHash });
        return errorResponse('QUOTA_EXCEEDED', 'Daily formatting limit reached. Try again later.', responseHeaders);
      }
    } catch {
      // Degrade-open: a missing quota RPC must not block the core formatting path.
      logEvent('info', { requestId, userIdHash, note: 'quota_degraded_open' });
    }
  }

  // API key
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    logEvent('error', { requestId, userIdHash, code: 'GEMINI_KEY_MISSING', transcriptHash });
    return errorResponse('GEMINI_KEY_MISSING', 'Formatter is not configured.', responseHeaders);
  }

  // Build prompt (transcript text is NEVER logged)
  const instruction =
    typeof body.instruction === 'string' && body.instruction.trim()
      ? body.instruction.trim()
      : DEFAULT_INSTRUCTION;

  const prompt = [
    'You are a transcript formatter. You ONLY restore sentence punctuation and',
    'sentence-start capitalization. You MUST NOT add, remove, reorder, summarize,',
    'translate, or correct any words, and you MUST preserve every filler word',
    '(um, uh, like, you know, basically, literally) exactly as spoken. If you are',
    'unsure, leave the words exactly as they are. Return ONLY the reformatted',
    'transcript text with no preamble, quotes, or code fences.',
    '',
    `Formatting instruction: ${instruction}`,
    '',
    'Transcript:',
    transcript,
  ].join('\n');

  // Call provider with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let providerStatus = 0;
  let rawModelText: string | null = null;
  try {
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    providerStatus = geminiResponse.status;
    if (!geminiResponse.ok) {
      // Extract ONLY Gemini's error STATUS ENUM (e.g. NOT_FOUND / RESOURCE_EXHAUSTED /
      // PERMISSION_DENIED / INVALID_ARGUMENT) — it diagnoses the 502 root cause and can
      // never contain transcript text. Never log the free-text body.
      let providerStatusEnum: string | undefined;
      try {
        const errBody = await geminiResponse.text();
        const parsed = JSON.parse(errBody) as { error?: { status?: unknown } };
        if (typeof parsed?.error?.status === 'string') providerStatusEnum = parsed.error.status;
      } catch {
        /* non-JSON error body — status code alone still diagnoses */
      }
      logEvent('error', { requestId, userIdHash, code: 'FORMATTER_PROVIDER_ERROR', providerStatus, providerStatusEnum, transcriptHash });
      return errorResponse('FORMATTER_PROVIDER_ERROR', 'Formatter provider error.', responseHeaders, {
        provider: PROVIDER,
        model: FORMATTER_MODEL,
        providerStatus,
        providerStatusEnum,
        requestId,
      });
    }
    const responseData = await geminiResponse.json();
    const text = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;
    rawModelText = typeof text === 'string' ? text : null;
  } catch (err) {
    const isTimeout = (err as Error)?.name === 'AbortError';
    const code: FormatterErrorCode = isTimeout ? 'FORMATTER_PROVIDER_TIMEOUT' : 'FORMATTER_PROVIDER_ERROR';
    logEvent('error', { requestId, userIdHash, code, providerStatus, transcriptHash });
    return errorResponse(code, isTimeout ? 'Formatter provider timed out.' : 'Formatter provider error.', responseHeaders, {
      provider: PROVIDER,
      model: FORMATTER_MODEL,
      requestId,
    });
  } finally {
    clearTimeout(timer);
  }

  const formatted = rawModelText ? cleanModelText(rawModelText) : '';
  if (!formatted) {
    logEvent('error', { requestId, userIdHash, code: 'FORMATTER_EMPTY_OUTPUT', providerStatus, transcriptHash });
    return errorResponse('FORMATTER_EMPTY_OUTPUT', 'Formatter returned an empty result.', responseHeaders, {
      provider: PROVIDER,
      model: FORMATTER_MODEL,
      requestId,
    });
  }

  const outputChars = formatted.length;
  const wordPreservingServerCheck = isWordPreserving(transcript, formatted);
  const latencyMs = Date.now() - startedAt;

  if (!wordPreservingServerCheck) {
    // Reject — do NOT return the altered text. Frontend seam keeps raw.
    logEvent('error', {
      requestId,
      userIdHash,
      code: 'FORMATTER_WORDS_CHANGED',
      providerStatus,
      inputChars,
      outputChars,
      latencyMs,
      transcriptHash,
    });
    return errorResponse('FORMATTER_WORDS_CHANGED', 'Formatter changed transcript words; rejected.', responseHeaders, {
      provider: PROVIDER,
      model: FORMATTER_MODEL,
      inputChars,
      outputChars,
      latencyMs,
      wordPreservingServerCheck,
      formatterVersion: FORMATTER_VERSION,
      requestId,
    });
  }

  logEvent('info', {
    requestId,
    userIdHash,
    code: 'OK',
    engine: engine ?? 'native',
    provider: PROVIDER,
    model: FORMATTER_MODEL,
    providerStatus,
    inputChars,
    outputChars,
    latencyMs,
    wordPreservingServerCheck,
    formatterVersion: FORMATTER_VERSION,
    transcriptHash,
  });

  return new Response(
    JSON.stringify({
      formatted,
      metadata: {
        provider: PROVIDER,
        model: FORMATTER_MODEL,
        inputChars,
        outputChars,
        latencyMs,
        wordPreservingServerCheck,
        formatterVersion: FORMATTER_VERSION,
        requestId,
      },
    }),
    {
      headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      status: 200,
    },
  );
}

// Start the server with real dependencies.
if (import.meta.main) {
  serve((req: Request) => {
    const supabaseClientFactory: SupabaseClientFactory = (authHeader) =>
      createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader! } } },
      );
    return handler(req, supabaseClientFactory);
  });
}
