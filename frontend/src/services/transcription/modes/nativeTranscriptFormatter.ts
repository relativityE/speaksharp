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
 * Apply the registered formatter to a saved Native transcript. Identity when no
 * formatter is installed. Never throws and never returns empty for non-empty
 * input: any formatter error falls back to the original text so a formatting
 * failure can never lose or blank a user's transcript.
 */
export async function formatNativeTranscript(raw: string): Promise<string> {
  const text = raw ?? '';
  if (!activeFormatter || !text.trim()) return text;

  try {
    const formatted = await activeFormatter(text);
    const result = (formatted ?? '').trim();
    return result.length > 0 ? formatted : text;
  } catch (error) {
    logger.warn({ error }, '[NativeTranscriptFormatter] Formatter failed; returning unformatted transcript');
    return text;
  }
}
