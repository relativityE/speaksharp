/** Content-free Practice Loop review telemetry. Generated coaching and provider errors never enter it. */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { COACHING_LIFECYCLE_END_REASONS, COACHING_LIFECYCLE_STAGES, GovernedEvent } from '@/services/telemetryAllowlist';
import { currentAttemptId, currentBootId, currentJourneyId } from '@/services/telemetry/journeyIdentity';
import type { ProviderCodeFields } from '@/services/telemetry/providerCodes';

export type PracticeLoopReviewFailureReason =
  | 'access_denied'
  | 'invalid_response'
  | 'network'
  | 'not_found'
  | 'rate_limited'
  | 'service_configuration'
  | 'transcript_unavailable'
  | 'unavailable';

const emit = (event: GovernedEvent, props: Record<string, unknown>): void => {
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

/**
 * #1258 option A (PM 6206983551) — the Edge function makes at most THREE provider attempts. The browser reports exactly
 * what the server said when it is a possible count (0–3); anything else (an impossible 4, a fraction, a string) is not
 * clamped into a believable value — it is reported as 0, the same as an absent count, and the allowlist rejects >3.
 */
export const MAX_REPORTED_PROVIDER_ATTEMPTS = 3;
export const reportedProviderAttempts = (value: unknown): number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_REPORTED_PROVIDER_ATTEMPTS ? Number(value) : 0;

export interface AiCoachingDiagnosticTelemetry extends Partial<ProviderCodeFields> {
  diagnostic_request_id?: string;
  diagnostic_attempt_id?: string;
  client_attempt: number;
  outcome: 'success' | 'retrying' | 'failure' | 'superseded' | 'network_failure';
  phase: string;
  reason: string;
  status: number | null;
  provider_status: number | null;
  provider: 'google_gemini' | 'none';
  configured_model: string | null;
  observed_model: string | null;
  source: 'fresh' | 'cache' | 'unknown';
  provider_attempts: number;
  retry_count: number;
  provider_duration_ms: number | null;
  total_duration_ms: number;
  prompt_sha256: string | null;
  product: 'open_mic' | 'focus_points' | 'unknown';
  has_session: boolean;
  client_release_id: string | null;
}

/** One safe event per completed server/client attempt; never includes saved speech or generated coaching. */
export const trackAiCoachingDiagnostic = (diagnostic: AiCoachingDiagnosticTelemetry): void =>
  emit('ai_coaching_diagnostic', { ...diagnostic });

/**
 * #1593 — the journey/boot/recording attempt a coaching request STARTED in. Captured once, at request start, and carried
 * on every lifecycle stage of that request, so a late answer for take A can never be attributed to take B by the ambient
 * envelope (which is read at push time). `attempt` is null outside a recording attempt — honest absence.
 */
export interface CoachingLifecycleOrigin { journeyId: string; bootId: string; attemptId: string | null }
export const snapshotCoachingOrigin = (): CoachingLifecycleOrigin => {
  try {
    return { journeyId: currentJourneyId(), bootId: currentBootId(), attemptId: currentAttemptId() };
  } catch {
    return { journeyId: '', bootId: '', attemptId: null };
  }
};

export type CoachingLifecycleStage = typeof COACHING_LIFECYCLE_STAGES[number];
export type CoachingLifecycleEndReason = typeof COACHING_LIFECYCLE_END_REASONS[number];

export interface CoachingLifecycleEvent {
  stage: CoachingLifecycleStage;
  requestId: string | null;
  attemptId: string | null;
  clientAttempt: number | null;
  origin: CoachingLifecycleOrigin;
  elapsedMs: number;
  product: 'open_mic' | 'focus_points' | 'unknown';
  endReason?: CoachingLifecycleEndReason;
  parseValid?: boolean;
  /** `ended: unmounted` only — whether the browser's wait was aborted on route exit (server settlement stays unknown). */
  clientAborted?: boolean;
}

/** One content-free lifecycle stage. Absent ids stay absent; nothing is inferred for a stage that did not happen. */
export const trackAiCoachingLifecycle = (event: CoachingLifecycleEvent): void =>
  emit('ai_coaching_lifecycle', {
    stage: event.stage,
    ...(event.requestId ? { diagnostic_request_id: event.requestId } : {}),
    ...(event.attemptId ? { diagnostic_attempt_id: event.attemptId } : {}),
    ...(event.clientAttempt ? { client_attempt: event.clientAttempt } : {}),
    ...(event.endReason ? { end_reason: event.endReason } : {}),
    ...(event.parseValid === undefined ? {} : { parse_valid: event.parseValid }),
    ...(event.clientAborted === undefined ? {} : { client_aborted: event.clientAborted }),
    elapsed_ms: Math.max(0, Math.min(600_000, Math.round(event.elapsedMs))),
    ...(event.origin.journeyId ? { origin_journey_id: event.origin.journeyId } : {}),
    ...(event.origin.bootId ? { origin_boot_id: event.origin.bootId } : {}),
    ...(event.origin.attemptId ? { origin_attempt_id: event.origin.attemptId } : {}),
    product: event.product,
  });
