import type { TranscriptConfidence } from '../contracts';
import { countTranscriptWords } from '@/utils/sessionAnalysis';

/**
 * Canonical word count — delegates to `countTranscriptWords`, the exact basis the legacy
 * wpm/clarity/score path uses (Unicode `\p{L}\p{N}` tokens), so every processor's word count
 * matches the value the current UI/analytics compute. This is the single source for word counting.
 */
export function countWords(text: string): number {
  return countTranscriptWords(text ?? '');
}

/**
 * Accumulate a committed-final transcript the way the store/app does (single source used by every
 * transcript-consuming processor). A `replacesRollingTranscript` final REPLACES the accumulated text —
 * but a BLANK/whitespace authoritative final must NOT wipe a valid committed transcript (mirrors the
 * store guard `transcript.replacesRollingTranscript && transcript.final.trim()`). Non-replacing finals
 * append in order.
 */
export function appendCommittedFinal(prev: string, text: string, replaces: boolean | undefined): string {
  if (replaces) return text.trim() ? text : prev;
  if (!text) return prev;
  return prev ? `${prev} ${text}`.replace(/\s+/g, ' ').trim() : text;
}

/** Longest run of words with no sentence-terminating punctuation — a run-on proxy. */
export function maxRunOnWords(text: string): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  return t
    .split(/[.!?]+/)
    .reduce((max, segment) => Math.max(max, countWords(segment)), 0);
}

/** Coarse transcript confidence from committed word count (refined against trust state at cutover). */
export function transcriptConfidence(finalWordCount: number): TranscriptConfidence {
  if (finalWordCount >= 20) return 'high';
  if (finalWordCount >= 5) return 'medium';
  return 'low';
}
