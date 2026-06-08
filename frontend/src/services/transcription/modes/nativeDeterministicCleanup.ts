/**
 * ============================================================================
 * NATIVE DETERMINISTIC CLEANUP (no model, no network, no LLM)
 * ============================================================================
 *
 * PRODUCT DECISION (2026-06-08)
 * ----------------------------
 * Native = the browser's built-in speech recognition (Web Speech API), lightly
 * normalized only. Transcript polish (real punctuation + truecasing) is the job of
 * Private (local Whisper) and Cloud (AssemblyAI), which format natively. Native must
 * NOT carry a paid/heavy formatting subsystem:
 *   - no LLM/Gemini formatting (removed — no recurring per-call cost; the measured
 *     Gemini path scored F1 0.53 on the one real-mic pair, with no evidence of a
 *     user-visible quality win to justify the cost).
 *   - no punctuation/truecasing model in the beta path (rpunct/fullstop/Silero are
 *     undeployable here — too big or no ONNX; NeMo-ONNX is only an UNGUARANTEED
 *     post-beta candidate, not a committed plan).
 *   - no async post-save rewrite, no fuzzy reconcile, no stacked formatters.
 *
 * This adapter registers through the existing `registerNativeTranscriptFormatter`
 * seam (so the word-preservation guard + telemetry + Private guard still apply) but
 * the registered function is a tiny deterministic, $0, word-preserving cleanup.
 *
 * THIS FUNCTION is intentionally tiny and deterministic. It only ever changes
 * whitespace, the first character's case, and a single trailing period. It is
 * word-preserving by construction: it never adds, removes, reorders, joins, splits,
 * or re-cases any word (mid-sentence engine capitals are left untouched —
 * "fixing" them would require guessing sentence boundaries we do not have).
 */
import logger from '../../../lib/logger';
import {
  registerNativeTranscriptFormatter,
  reportNativeFormatterProviderMeta,
  type NativeTranscriptFormatter,
} from './nativeTranscriptFormatter';

export const NATIVE_DETERMINISTIC_FORMATTER_VERSION = 'native-deterministic@1.0.0';

/**
 * Deterministic, word-preserving cleanup for a saved Native transcript.
 *
 * Transforms (conservative, in order):
 *   1. collapse runs of whitespace to a single space + trim
 *   2. capitalize the first alphabetic character of the transcript
 *   3. append a single '.' iff the text has no terminal punctuation (. ! ?)
 *
 * Idempotent: normalizeNativeTranscript(normalizeNativeTranscript(x)) === normalizeNativeTranscript(x).
 */
export function normalizeNativeTranscript(raw: string): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return text;

  // 1) Capitalize only the FIRST alphabetic character (after any leading quotes/brackets).
  //    Deterministic and safe; we do NOT touch mid-sentence casing (would require
  //    sentence-boundary guessing we cannot do reliably without punctuation).
  // Leading skip class is non-alphanumeric only (quotes/brackets) — never digits — so a
  // transcript that starts with a number ("7 seconds…") has no first letter to capitalize.
  let out = text.replace(/^([^A-Za-z0-9]*)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase());

  // 2) Append a single terminal period ONLY when there is no closing . ! ? — so the
  //    transcript doesn't look unfinished. Never changes a word.
  if (!/[.!?]$/.test(out)) out += '.';

  return out;
}

/**
 * Build the deterministic Native formatter for the registration seam. Reports
 * provider telemetry (provider 'deterministic') so proofs can distinguish "ran the
 * deterministic cleanup" from "no formatter / fell back to raw". Pure + synchronous.
 */
export function createDeterministicNativeFormatter(): NativeTranscriptFormatter {
  return (raw: string): string => {
    const text = raw ?? '';
    reportNativeFormatterProviderMeta({
      provider: 'deterministic',
      functionName: 'normalizeNativeTranscript',
      formatterVersion: NATIVE_DETERMINISTIC_FORMATTER_VERSION,
      inputChars: text.length,
    });
    return normalizeNativeTranscript(text);
  };
}

/**
 * Hard guard: the Native formatter must NEVER be registered for Private mode.
 * Private is the local/privacy path and must not run a Native-only formatter.
 */
export function assertNotPrivateMode(mode: string | undefined): void {
  if (mode === 'private') {
    throw new Error('[NativeDeterministicCleanup] Refusing to register Native formatter for Private mode (privacy guard).');
  }
}

/**
 * Register the deterministic Native formatter for production, Native mode only.
 * Same API as the retired Gemini adapter so call sites only change their import.
 * No-op-safe: pass the active STT mode; throws if called for Private.
 * Returns the previously-registered formatter (for restore in tests).
 */
export function registerNativeProductionFormatter(
  mode: string | undefined,
): NativeTranscriptFormatter | null {
  assertNotPrivateMode(mode);
  if (mode !== 'native') {
    logger.info({ mode }, '[NativeDeterministicCleanup] Skipping registration for non-Native mode');
    return null;
  }
  return registerNativeTranscriptFormatter(createDeterministicNativeFormatter());
}
