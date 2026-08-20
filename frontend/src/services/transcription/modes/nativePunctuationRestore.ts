/**
 * ============================================================================
 * NATIVE PUNCTUATION RESTORE (deterministic, word-preserving, $0, offline)
 * ============================================================================
 *
 * GOAL
 * ----
 * Modestly and SAFELY improve the readability of a SAVED Native (Web Speech)
 * transcript. Runs after save through the async formatter seam.
 *
 * NON-GOALS (explicit)
 * --------------------
 *   - NOT perfect parity with Private/Cloud model punctuation.
 *   - NOT live punctuation (SAVED transcript only).
 *   - NOT recovering fillers/words the browser never emitted.
 *   - NO audio, NO network, NO LLM, NO paid API, NO per-call cost.
 *
 * WHY NO INTERNAL SENTENCE BREAKS
 * -------------------------------
 * An earlier pass inserted periods before interior Title-case words (Web Speech
 * capitalizes each result-segment's first word). But a lone interior capital is
 * FUNDAMENTALLY AMBIGUOUS between a proper noun and a segment start, and no
 * string-only signal separates them reliably: "i called Sarah" (proper noun,
 * must NOT split) looks identical in structure to "... the feedback Then we ..."
 * (segment start). Guessing produces FALSE sentence boundaries
 * ("i called. Sarah ...", "to John and. Sarah ..."), which is worse than a
 * run-on. Per the product decision, we ship the modest, safe improvement instead
 * of aggressive punctuation that invents boundaries. (If real Web Speech segment
 * boundaries are ever plumbed through from the capture path, revisit — that would
 * be a high-confidence signal; the stitched string is not.)
 *
 * WHAT IT DOES (all word-preserving, all unambiguous)
 * ---------------------------------------------------
 *   1. collapse whitespace + trim
 *   2. capitalize the first alphabetic character of the transcript
 *   3. uppercase the isolated pronoun "i" (and i'm/i'll/i've/i'd)
 *   4. append a single terminal period iff there is no closing . ! ?
 * It NEVER adds/removes/reorders/joins/splits a word, so fillers (um, uh, like,
 * you know, basically) are preserved exactly. The nativeTranscriptFormatter seam
 * independently re-checks word-preservation and falls back to raw on any
 * violation/timeout — this is defence-in-depth, not the sole guard.
 *
 * EASY TO DISABLE
 * ---------------
 * `isNativePunctuationRestoreEnabled()` (env `VITE_NATIVE_PUNCTUATION_RESTORE`)
 * selects this restorer vs. the minimal deterministic cleanup at registration time.
 */
import { reportNativeFormatterProviderMeta, type NativeTranscriptFormatter } from './nativeTranscriptFormatter';

export const NATIVE_PUNCTUATION_RESTORE_VERSION = 'native-punct-restore@1.0.0';

/** Default when no env override is set. */
const NATIVE_PUNCTUATION_RESTORE_DEFAULT = true;

/**
 * Whether the punctuation restorer (vs. the minimal cleanup) is active for the
 * production Native path. Trivially disable-able via env without a code change.
 */
export function isNativePunctuationRestoreEnabled(): boolean {
  let override: unknown;
  try {
    // DIRECT static access — casting import.meta / optional-chaining `?.env` defeats Vite's static
    // replacement and inlines the WHOLE env object (incl. the Vercel deploy SHA) into this chunk.
    override = import.meta.env.VITE_NATIVE_PUNCTUATION_RESTORE;
  } catch {
    override = undefined;
  }
  if (override === '0' || override === 'false' || override === false) return false;
  if (override === '1' || override === 'true' || override === true) return true;
  return NATIVE_PUNCTUATION_RESTORE_DEFAULT;
}

/** "I" and its contractions — the one truly unambiguous casing fix. */
const I_FORMS = new Set(["i", "i'm", "i'll", "i've", "i'd"]);

function stripEdgePunct(word: string): string {
  return word.replace(/^[^A-Za-z0-9']+/, '').replace(/[^A-Za-z0-9']+$/, '');
}

/** Ends a sentence already (allowing trailing closing quotes/brackets). */
function endsWithTerminal(word: string): boolean {
  return /[.!?]["')\]]*$/.test(word);
}

/** Capitalize the first alphabetic character of a token (leading quotes/brackets skipped). */
function capitalizeFirstAlpha(word: string): string {
  return word.replace(/^([^A-Za-z0-9]*)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Uppercase an isolated "i" / "i'm" / "i'll" / "i've" / "i'd", preserving edge punctuation. */
function fixStandaloneI(word: string): string {
  if (I_FORMS.has(stripEdgePunct(word).toLowerCase())) {
    return word.replace('i', 'I'); // first (leading) 'i' only; idempotent on already-"I"
  }
  return word;
}

/**
 * Deterministic, word-preserving readability cleanup for a saved Native transcript.
 * Safe transformations only — NO internal sentence breaks (see file header). Same
 * word sequence in and out; only whitespace, casing, and a single terminal period change.
 */
export function restoreNativePunctuation(raw: string): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return text;

  const tokens = text.split(' ');
  const fixed = tokens.map((t, i) => {
    const cased = fixStandaloneI(t);
    return i === 0 ? capitalizeFirstAlpha(cased) : cased;
  });

  let out = fixed.join(' ');
  if (!endsWithTerminal(fixed[fixed.length - 1])) out += '.';
  return out;
}

/**
 * Formatter for the registration seam. Reports provider telemetry
 * (provider 'deterministic-restore') so proofs can distinguish it from the minimal
 * cleanup and from "no formatter / fell back to raw". Pure + synchronous.
 */
export function createPunctuationRestoreNativeFormatter(): NativeTranscriptFormatter {
  return (raw: string): string => {
    const text = raw ?? '';
    reportNativeFormatterProviderMeta({
      provider: 'deterministic-restore',
      functionName: 'restoreNativePunctuation',
      formatterVersion: NATIVE_PUNCTUATION_RESTORE_VERSION,
      inputChars: text.length,
    });
    return restoreNativePunctuation(text);
  };
}
