/**
 * The evaluation prompt: exactly what the handler sends for a saved take with this evidence. Kept in its own module so the handler's
 * parity test (index.test.ts) pins only this file and the committed transcript set, while the metrics in evaluator.ts can change
 * without re-pinning the reviewed synthetic-key test profile (scripts/lib/nativeTestExecutionEvidence.mjs).
 */
import { buildCoachingPrompt, buildDeliverySignals, buildFocusCoachingText, type FocusContext } from '../index.ts';

/** The handler truncates longer transcripts; the evaluation set stays under it so its prompts equal the handler's. */
export const EVALUATION_MAX_TRANSCRIPT_CHARS = 8000;

export interface EvaluationItem {
  id: string;
  product: 'open_mic' | 'focus_points';
  transcript: string;
  wpm: number | null;
  filler_counts: Record<string, number>;
  /** Saved aggregate pause evidence, as a session row stores it. An all-zero object is an unmeasured take (no pause lines). */
  pause_metrics?: Record<string, number> | null;
  next_action_metric?: 'wpm' | 'filler_rate';
  focus?: { topic: string | null; points: Array<{ label: string; verdict: 'detected' | 'not_detected' | 'unavailable'; detectedAtSeconds: number | null }> };
  grounding: { anchors: string[]; unsupported: string[] };
}

/** The exact prompt the handler would send for this take (the transcript is never truncated: the set stays under the limit). */
export function evaluationPrompt(item: EvaluationItem): string {
  const focus: FocusContext = item.focus ? { kind: 'focus', topic: item.focus.topic, points: item.focus.points } : { kind: 'none' };
  const session = {
    transcript: item.transcript, transcript_state: 'ready', duration: null, total_words: null, filler_words: null,
    filler_counts: item.filler_counts, clarity_score: null, wpm: item.wpm, pause_metrics: item.pause_metrics ?? null,
    next_action_signal: item.next_action_metric ? { metric: item.next_action_metric } : null, ai_suggestions: null, product: item.product,
  } as Parameters<typeof buildDeliverySignals>[0];
  return buildCoachingPrompt(item.transcript, buildDeliverySignals(session, focus) + buildFocusCoachingText(focus));
}
