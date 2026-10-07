/** Content-free Practice Loop review telemetry. Generated coaching and provider errors never enter it. */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { GovernedEvent } from '@/services/telemetryAllowlist';
import { reviewSubjectFor } from '@/services/telemetry/reviewSubject';

export type PracticeLoopReviewFailureReason =
  | 'access_denied'
  | 'invalid_response'
  | 'network'
  | 'not_found'
  | 'rate_limited'
  | 'service_configuration'
  | 'transcript_unavailable'
  | 'unavailable';

/**
 * #1258 (contract 6037393538) — who the event is about, never what was said.
 *  - `sessionId` is used ONLY to look up the saved take's frozen `subject_*` identity; it is never emitted.
 *  - `requestSeq` names one logical review lifecycle; its requested and terminal events share it.
 *  - `invocations` counts the server calls inside that lifecycle (first call, the one recoverable retry, 425 waits).
 *  - `source` says whether a rendered pair was generated now or was already stored on the session.
 */
export type PracticeLoopReviewContext = {
  sessionId?: string | null;
  product?: 'open_mic' | 'focus_points';
  requestSeq?: number;
  invocations?: number;
  source?: 'generated' | 'stored';
};

const ownership = (ctx: PracticeLoopReviewContext | undefined): Record<string, string | number> => {
  if (!ctx) return {};
  const out: Record<string, string | number> = { ...(reviewSubjectFor(ctx.sessionId) ?? {}) };
  if (ctx.product) out.product = ctx.product;
  if (ctx.requestSeq !== undefined) out.review_request_seq = ctx.requestSeq;
  if (ctx.invocations !== undefined) out.invocations = ctx.invocations;
  if (ctx.source) out.review_source = ctx.source;
  return out;
};

const emit = (event: GovernedEvent, props: Record<string, string | number | boolean>): void => {
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

export const trackPracticeLoopReviewRequested = (ctx?: PracticeLoopReviewContext): void =>
  emit('practice_loop_review_requested', { review_ready: true, ...ownership(ctx) });

export const trackPracticeLoopReviewCompleted = (ctx?: PracticeLoopReviewContext): void =>
  emit('practice_loop_review_completed', { ...completeShape, ...ownership(ctx) });

/** The edge function returns success only after it has persisted and read back the exact result. */
export const trackPracticeLoopReviewPersisted = (ctx?: PracticeLoopReviewContext): void =>
  emit('practice_loop_review_persisted', { ...completeShape, ...ownership(ctx) });

export const trackPracticeLoopReviewRendered = (ctx?: PracticeLoopReviewContext): void =>
  emit('practice_loop_review_rendered', { ...completeShape, ...ownership(ctx) });

export const trackPracticeLoopReviewFailed = (reason: PracticeLoopReviewFailureReason, ctx?: PracticeLoopReviewContext): void =>
  emit('practice_loop_review_failed', { reason, ...ownership(ctx) });
