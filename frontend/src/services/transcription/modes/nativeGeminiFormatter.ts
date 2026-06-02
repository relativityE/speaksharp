/**
 * ============================================================================
 * NATIVE GEMINI FORMATTER ADAPTER (trusted, server-side, Native-only)
 * ============================================================================
 *
 * The trusted punctuation/casing restoration formatter for the Native engine,
 * wired through the existing `registerNativeTranscriptFormatter` seam. It restores
 * sentence boundaries + casing on the SAVED Native transcript only — never live
 * partials, never Private.
 *
 * WHY GEMINI (server-side) IS ACCEPTABLE FOR NATIVE:
 * Native is already NOT on-device — Chrome Web Speech sends audio to Google. So
 * sending the transcript TEXT to our existing Gemini Edge Function (the same vetted
 * provider relationship behind `get-ai-suggestions`) does not weaken a privacy
 * promise the way it would for Private. Private MUST stay local and must never call
 * this adapter (enforced by `assertNotPrivateMode`).
 *
 * SAFETY: the seam's `formatNativeTranscript` wraps this with a word-preservation
 * guard — if Gemini adds/removes/reorders/"corrects" words (or drops a filler), the
 * output is rejected and the raw transcript is kept. This adapter only needs to ask
 * for punctuation/casing restoration; the guard enforces it.
 *
 * DEPLOYMENT: requires a `format-transcript` Supabase Edge Function (mirrors
 * `get-ai-suggestions`). Until deployed, invoke() errors -> seam falls back to raw
 * (no regression). Edge function contract: body `{ transcript }` -> `{ formatted }`.
 */
import { getSupabaseClient } from '../../../lib/supabaseClient';
import logger from '../../../lib/logger';
import {
  registerNativeTranscriptFormatter,
  type NativeTranscriptFormatter,
} from './nativeTranscriptFormatter';

export const FORMAT_TRANSCRIPT_EDGE_FUNCTION = 'format-transcript';

/**
 * The strict instruction the edge function applies. Exported so the (separately
 * deployed) edge function and tests share one source of truth.
 */
export const NATIVE_FORMATTER_INSTRUCTION = [
  'Restore sentence punctuation and sentence-start capitalization only.',
  'Do NOT add, remove, reorder, summarize, translate, or correct any words.',
  'Preserve filler words exactly as spoken: um, uh, like, you know, basically, literally.',
  'Return only the reformatted transcript text.',
].join(' ');

/**
 * Build the Native formatter that calls the Gemini `format-transcript` edge fn.
 * Returns the raw input on any error/empty response — the seam's guard provides
 * the word-preservation backstop on top of this.
 */
export function createGeminiNativeFormatter(): NativeTranscriptFormatter {
  return async (raw: string): Promise<string> => {
    const text = raw ?? '';
    if (!text.trim()) return text;

    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.warn('[NativeGeminiFormatter] Supabase client unavailable; returning raw transcript');
      return text;
    }

    const { data, error } = await supabase.functions.invoke(FORMAT_TRANSCRIPT_EDGE_FUNCTION, {
      body: { transcript: text, instruction: NATIVE_FORMATTER_INSTRUCTION },
    });
    if (error) throw error; // bubble to formatNativeTranscript -> falls back to raw
    if (data && typeof (data as { error?: string }).error === 'string') {
      throw new Error((data as { error: string }).error);
    }
    const formatted = (data as { formatted?: unknown })?.formatted;
    return typeof formatted === 'string' && formatted.trim().length > 0 ? formatted : text;
  };
}

/**
 * Hard guard: the Native formatter must NEVER be registered for Private mode.
 * Private is the local/privacy path and must not send transcript text off-device.
 */
export function assertNotPrivateMode(mode: string | undefined): void {
  if (mode === 'private') {
    throw new Error('[NativeGeminiFormatter] Refusing to register Native formatter for Private mode (privacy guard).');
  }
}

/**
 * Register the Gemini Native formatter for production, Native mode only.
 * No-op-safe: pass the active STT mode; throws if called for Private.
 * Returns the previously-registered formatter (for restore in tests).
 */
export function registerNativeProductionFormatter(
  mode: string | undefined,
): NativeTranscriptFormatter | null {
  assertNotPrivateMode(mode);
  if (mode !== 'native') {
    logger.info({ mode }, '[NativeGeminiFormatter] Skipping registration for non-Native mode');
    return null;
  }
  return registerNativeTranscriptFormatter(createGeminiNativeFormatter());
}
