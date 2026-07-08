import type { TranscriptConfidence } from '../contracts';

/** Word count using the app-wide convention (matches fillerWordUtils/sessionAnalysis). */
export function countWords(text: string): number {
  const t = (text ?? '').trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
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
