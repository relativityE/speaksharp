/**
 * ============================================================================
 * NATIVE TRANSCRIPT FORMATTER (pluggable restoration seam)
 * ============================================================================
 *
 * PROBLEM
 * -------
 * Chrome Web Speech (the Native engine) returns weakly-formatted text: little or
 * no terminal punctuation and per-result-segment capitalization. When the app
 * stitches segments together (`appendTranscriptSegment`), each segment's leading
 * capital can land mid-sentence (e.g. "...point. Starts Now basically..."),
 * producing run-on, oddly-capitalized saved transcripts.
 *
 * CONSTRAINT (set by product)
 * ---------------------------
 * Do NOT hand-roll punctuation/casing regexes in the hot path. Real sentence
 * boundary + casing restoration must come from a trusted model/API, because a
 * heuristic would corrupt acronyms, names, fillers, and coaching terms.
 *
 * THIS MODULE
 * -----------
 * Provides the *seam* for that trusted formatter without committing to a vendor:
 *   - `registerNativeTranscriptFormatter(fn)` installs a restoration function.
 *   - `formatNativeTranscript(text)` applies it (identity if none registered).
 *
 * The DEFAULT is identity — installing this seam changes NO behavior until a
 * trusted formatter is registered. It is applied only to the SAVED transcript
 * (`NativeBrowser.getTranscript()`), never to live partials, so latency and the
 * live UX are untouched. The formatter is async so a network/model call fits,
 * and failures fall back to the unformatted text (never lose the transcript).
 */

import logger from '../../../lib/logger';

export type NativeTranscriptFormatter = (raw: string) => Promise<string> | string;

let activeFormatter: NativeTranscriptFormatter | null = null;

/**
 * Proof telemetry for the last saved-transcript formatting attempt. Exposed to the
 * browser (window.__NATIVE_FORMATTER_LAST__) so the test harness can prove:
 *   - readability improved (inputChars/outputChars, the accepted formatted text)
 *   - words/fillers unchanged (wordPreserving true on accepted results)
 *   - fallback works (fallbackToRaw true + errorCode on provider failure)
 * Contains NO transcript text — only counts, ids, and flags.
 */
export interface NativeFormatterTelemetry {
  attempted: boolean;
  provider: string | null;
  functionName: string | null;
  formatterVersion: string | null;
  requestId: string | null;
  latencyMs: number | null;
  inputChars: number | null;
  outputChars: number | null;
  /** Server-side word-preservation check result (from the edge function metadata). */
  serverWordPreserving: boolean | null;
  /** Client-side seam guard result (final authority on acceptance). */
  wordPreserving: boolean | null;
  errorCode: string | null;
  /** Upstream provider HTTP status (e.g. Gemini's) on a provider error — diagnoses a 502. */
  providerStatus: number | null;
  fallbackToRaw: boolean;
  at: number;
}

const EMPTY_TELEMETRY: NativeFormatterTelemetry = {
  attempted: false,
  provider: null,
  functionName: null,
  formatterVersion: null,
  requestId: null,
  latencyMs: null,
  inputChars: null,
  outputChars: null,
  serverWordPreserving: null,
  wordPreserving: null,
  errorCode: null,
  providerStatus: null,
  fallbackToRaw: false,
  at: 0,
};

let lastTelemetry: NativeFormatterTelemetry = { ...EMPTY_TELEMETRY };
// Provider-side fields reported by the active adapter for the in-flight attempt.
let pendingProviderMeta: Partial<NativeFormatterTelemetry> | null = null;

/**
 * Called by the formatter adapter (e.g. nativeGeminiFormatter) to report the
 * provider-side outcome of the in-flight attempt (requestId, latency, char counts,
 * server word-preservation check, error code). The seam merges this with the final
 * accept/fallback decision.
 */
export function reportNativeFormatterProviderMeta(meta: Partial<NativeFormatterTelemetry>): void {
  pendingProviderMeta = { ...(pendingProviderMeta ?? {}), ...meta };
}

/** The telemetry for the most recent saved-transcript formatting attempt. */
export function getNativeFormatterTelemetry(): NativeFormatterTelemetry {
  return lastTelemetry;
}

function publishTelemetry(t: NativeFormatterTelemetry): void {
  lastTelemetry = t;
  try {
    (globalThis as { __NATIVE_FORMATTER_LAST__?: NativeFormatterTelemetry }).__NATIVE_FORMATTER_LAST__ = t;
  } catch {
    /* non-browser / locked global — telemetry getter still works */
  }
}

/**
 * Install the trusted punctuation/casing restoration formatter. Pass `null` to
 * remove it (revert to identity). Returns the previously-registered formatter so
 * callers/tests can restore prior state.
 */
export function registerNativeTranscriptFormatter(
  formatter: NativeTranscriptFormatter | null,
): NativeTranscriptFormatter | null {
  const previous = activeFormatter;
  activeFormatter = formatter;
  return previous;
}

/** Whether a trusted formatter is currently installed. */
export function hasNativeTranscriptFormatter(): boolean {
  return activeFormatter !== null;
}

/**
 * The word sequence of a transcript, ignoring case and punctuation. This is the
 * unit the word-preservation guard compares: punctuation/casing may change, words
 * may not.
 */
export function transcriptWordSequence(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * A formatter output is "word-preserving" iff it changes ONLY punctuation, casing,
 * and spacing — the exact same word sequence remains. Restoring sentence
 * boundaries + casing passes; adding, removing, reordering, summarizing, or
 * "correcting" words FAILS. This is the safety contract: fillers (um, uh, like,
 * you know, basically, literally) cannot be dropped and the formatter cannot
 * rewrite the user's words.
 */
export function isWordPreserving(raw: string, formatted: string): boolean {
  const a = transcriptWordSequence(raw);
  const b = transcriptWordSequence(formatted);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Apply the registered formatter to a saved Native transcript. Identity when no
 * formatter is installed. NEVER throws and NEVER changes the user's words:
 *   - no formatter / blank input            -> raw text
 *   - formatter throws                       -> raw text
 *   - formatter returns empty                -> raw text
 *   - formatter changes the word sequence    -> raw text (word-preservation guard)
 * Only punctuation/casing/spacing-only reformatting is accepted. Applied to SAVED
 * text only (never live partials).
 */
export async function formatNativeTranscript(raw: string): Promise<string> {
  const text = raw ?? '';
  if (!text.trim()) return text;

  // No formatter wired: publish telemetry so __NATIVE_FORMATTER_LAST__ is never
  // silently null. A null reading previously hid the real bug (formatter never
  // registered on the production path); attempted:false + NO_FORMATTER makes
  // "not registered" distinguishable from "ran and fell back".
  if (!activeFormatter) {
    publishTelemetry({
      ...EMPTY_TELEMETRY,
      attempted: false,
      fallbackToRaw: true,
      errorCode: 'NO_FORMATTER',
      inputChars: text.length,
      at: Date.now(),
    });
    return text;
  }

  // Reset the side-channel; the adapter fills provider fields during the call.
  pendingProviderMeta = null;
  const startedAt = Date.now();
  const finalize = (
    outcome: { fallbackToRaw: boolean; wordPreserving: boolean | null; errorCode?: string | null },
    outputChars: number | null,
  ): void => {
    const meta = pendingProviderMeta ?? {};
    publishTelemetry({
      attempted: true,
      provider: meta.provider ?? null,
      functionName: meta.functionName ?? null,
      formatterVersion: meta.formatterVersion ?? null,
      requestId: meta.requestId ?? null,
      latencyMs: meta.latencyMs ?? Date.now() - startedAt,
      inputChars: meta.inputChars ?? text.length,
      outputChars: meta.outputChars ?? outputChars,
      serverWordPreserving: meta.serverWordPreserving ?? null,
      wordPreserving: outcome.wordPreserving,
      // Prefer the adapter's SPECIFIC code (meta.errorCode, e.g. FORMATTER_PROVIDER_ERROR)
      // over a generic catch default, so a 502 isn't collapsed to plain FORMATTER_ERROR.
      errorCode: outcome.errorCode ?? meta.errorCode ?? (outcome.fallbackToRaw ? 'FORMATTER_ERROR' : null),
      providerStatus: meta.providerStatus ?? null,
      fallbackToRaw: outcome.fallbackToRaw,
      at: startedAt,
    });
  };

  try {
    const formatted = await activeFormatter(text);
    const result = (formatted ?? '').trim();
    if (result.length === 0) {
      finalize({ fallbackToRaw: true, wordPreserving: null, errorCode: 'EMPTY_RESULT' }, 0);
      return text;
    }
    if (!isWordPreserving(text, formatted)) {
      logger.warn(
        { rawLength: text.length, formattedLength: result.length },
        '[NativeTranscriptFormatter] Formatter changed word content; rejecting and returning unformatted transcript',
      );
      finalize({ fallbackToRaw: true, wordPreserving: false, errorCode: 'CLIENT_WORDS_CHANGED' }, result.length);
      return text;
    }
    finalize({ fallbackToRaw: false, wordPreserving: true }, formatted.length);
    return formatted;
  } catch (error) {
    logger.warn({ error }, '[NativeTranscriptFormatter] Formatter failed; returning unformatted transcript');
    finalize(
      // No hardcoded code here: a Supabase FunctionsHttpError carries no `.code`, so
      // let the adapter's reported meta.errorCode (the SPECIFIC edge-fn code) win.
      { fallbackToRaw: true, wordPreserving: null, errorCode: (error as { code?: string })?.code },
      null,
    );
    return text;
  }
}
