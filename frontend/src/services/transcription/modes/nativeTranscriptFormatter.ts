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
  if (!activeFormatter || !text.trim()) return text;

  try {
    const formatted = await activeFormatter(text);
    const result = (formatted ?? '').trim();
    if (result.length === 0) return text;
    if (!isWordPreserving(text, formatted)) {
      logger.warn(
        { rawLength: text.length, formattedLength: result.length },
        '[NativeTranscriptFormatter] Formatter changed word content; rejecting and returning unformatted transcript',
      );
      return text;
    }
    return formatted;
  } catch (error) {
    logger.warn({ error }, '[NativeTranscriptFormatter] Formatter failed; returning unformatted transcript');
    return text;
  }
}
