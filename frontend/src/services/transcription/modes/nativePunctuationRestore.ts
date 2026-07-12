/**
 * ============================================================================
 * NATIVE PUNCTUATION RESTORE (deterministic, word-preserving, $0, offline)
 * ============================================================================
 *
 * GOAL
 * ----
 * Materially improve the readability of a SAVED Native (Web Speech) transcript by
 * restoring internal sentence boundaries + capitalization. Web Speech returns a
 * near-punctuation-free run-on; this inserts periods and capitalizes sentence
 * starts so the saved/history/detail/PDF transcript reads in sentences.
 *
 * NON-GOALS (explicit)
 * --------------------
 *   - NOT perfect parity with Private/Cloud model punctuation.
 *   - NOT live punctuation (SAVED transcript only, runs after save via the seam).
 *   - NOT recovering fillers/words the browser never emitted.
 *   - NO audio, NO network, NO LLM, NO paid API, NO per-call cost.
 *
 * SAFETY CONTRACT
 * ---------------
 * WORD-PRESERVING BY CONSTRUCTION: this only changes whitespace, casing, and
 * inserted punctuation. It NEVER adds, removes, reorders, joins, or splits a word,
 * so fillers (um, uh, like, you know, basically, literally) are preserved exactly.
 * The `nativeTranscriptFormatter` seam independently re-checks word-preservation and
 * falls back to raw on any violation/timeout — this module is defence-in-depth, not
 * the sole guard.
 *
 * PRECISION OVER RECALL
 * ---------------------
 * Deterministic boundary detection on conversational speech is error-prone (the
 * 2026-06-08 product note is right to be wary). The ONE high-precision signal is the
 * engine's own segmentation: Web Speech capitalizes the first word of each
 * recognition result (a real pause boundary). So this breaks only at an interior
 * Title-case word — and only when it is not bound to a preceding article/preposition
 * (proper-noun guard) and the current sentence is already substantial. It respects
 * punctuation the engine already emitted. It deliberately does NOT break on ambiguous
 * lowercase discourse words (so/well/then/and/but) or at an arbitrary length cap —
 * both produce misleading breaks ("it went. Well ...", "first and. Then ..."). When
 * there is no boundary signal it leaves the text as one sentence rather than invent one.
 *
 * EASY TO DISABLE
 * ---------------
 * `isNativePunctuationRestoreEnabled()` (env `VITE_NATIVE_PUNCTUATION_RESTORE`)
 * selects this restorer vs. the minimal deterministic cleanup at registration time.
 * If the real-mic proof is weak, flip it off — the Native path reverts to the
 * whitespace/first-cap/trailing-period cleanup with zero other change.
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
    override = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_NATIVE_PUNCTUATION_RESTORE;
  } catch {
    override = undefined;
  }
  if (override === '0' || override === 'false' || override === false) return false;
  if (override === '1' || override === 'true' || override === true) return true;
  return NATIVE_PUNCTUATION_RESTORE_DEFAULT;
}

// --- Tunables (conservative on purpose) -------------------------------------
const MIN_SENTENCE_WORDS = 4; // don't emit tiny fragments between boundaries

/**
 * Words that bind a following capitalized word into a noun phrase (article /
 * preposition / possessive / title). When an interior Title-case word follows one of
 * these it is almost certainly a proper noun, NOT a sentence start — so we do not
 * break there. This is the proper-noun false-split guard.
 */
const NOUN_PHRASE_BINDERS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'for', 'from',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'mr', 'mrs', 'ms', 'dr', 'st', 'mount', 'lake', 'san', 'new',
]);

/** "I" and its contractions — always capital, never a sentence-boundary signal. */
const I_FORMS = new Set(["i", "i'm", "i'll", "i've", "i'd"]);

function stripEdgePunct(word: string): string {
  return word.replace(/^[^A-Za-z0-9']+/, '').replace(/[^A-Za-z0-9']+$/, '');
}

/** Title-case (Xx…), i.e. an engine segment-start capital — not an ALLCAPS acronym. */
function isTitleCaseWord(word: string): boolean {
  const core = stripEdgePunct(word);
  return /^[A-Z][a-z]/.test(core);
}

/** Ends a sentence already (allowing trailing closing quotes/brackets). */
function endsWithTerminal(word: string): boolean {
  return /[.!?]["')\]]*$/.test(word);
}

/** Capitalize the first alphabetic character of a token (leading quotes/brackets skipped). */
function capitalizeFirstAlpha(word: string): string {
  return word.replace(/^([^A-Za-z0-9]*)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Uppercase a standalone lowercase "i" token, preserving edge punctuation ("i," -> "I,"). */
function fixStandaloneI(word: string): string {
  if (stripEdgePunct(word).toLowerCase() === 'i') {
    return word.replace(/i/, 'I');
  }
  return word;
}

function assembleSentence(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const fixed = tokens.map((t, i) => {
    const cased = fixStandaloneI(t);
    return i === 0 ? capitalizeFirstAlpha(cased) : cased;
  });
  let sentence = fixed.join(' ');
  if (!endsWithTerminal(fixed[fixed.length - 1])) sentence += '.';
  return sentence;
}

/**
 * Deterministic, word-preserving punctuation restoration for a saved Native transcript.
 * Same word sequence in and out; only whitespace, casing, and inserted punctuation change.
 */
export function restoreNativePunctuation(raw: string): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return text;

  const tokens = text.split(' ');
  const sentences: string[][] = [];
  let current: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    current.push(token);
    const next = tokens[i + 1];
    let boundary = false;

    if (endsWithTerminal(token)) {
      // Respect punctuation the engine already emitted.
      boundary = true;
    } else if (next) {
      const prevCore = stripEdgePunct(token).toLowerCase();
      const nextCore = stripEdgePunct(next).toLowerCase();
      const longEnough = current.length >= MIN_SENTENCE_WORDS;

      if (
        longEnough &&
        isTitleCaseWord(next) &&
        !I_FORMS.has(nextCore) &&
        !NOUN_PHRASE_BINDERS.has(prevCore)
      ) {
        // The one high-precision signal: an interior engine segment-start capital that
        // is not bound to a preceding article/preposition (so it is a sentence start,
        // not a proper noun). Ambiguous lowercase markers and length caps are NOT used
        // — they invent misleading breaks.
        boundary = true;
      }
    }

    if (boundary && next) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length) sentences.push(current);

  return sentences.map(assembleSentence).join(' ');
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
