/** Content-free Practice Loop review telemetry. Generated coaching and provider errors never enter it. */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { GovernedEvent } from '@/services/telemetryAllowlist';

export type PracticeLoopReviewFailureReason =
  | 'access_denied'
  | 'invalid_response'
  | 'network'
  | 'not_found'
  | 'rate_limited'
  | 'transcript_unavailable'
  | 'unavailable';

const emit = (event: GovernedEvent, props: Record<string, string | boolean>): void => {
  try {
    analyticsBuffer.push(event, props, 'LOW');
  } catch {
    // Review availability must never depend on best-effort telemetry.
  }
};

const completeShape = {
  has_what_went_well: true,
  has_what_to_improve: true,
} as const;

export const trackPracticeLoopReviewRequested = (): void =>
  emit('practice_loop_review_requested', { review_ready: true });

export const trackPracticeLoopReviewCompleted = (): void =>
  emit('practice_loop_review_completed', completeShape);

/** The edge function returns success only after it has persisted and read back the exact result. */
export const trackPracticeLoopReviewPersisted = (): void =>
  emit('practice_loop_review_persisted', completeShape);

export const trackPracticeLoopReviewRendered = (): void =>
  emit('practice_loop_review_rendered', completeShape);

export const trackPracticeLoopReviewFailed = (reason: PracticeLoopReviewFailureReason): void =>
  emit('practice_loop_review_failed', { reason });
