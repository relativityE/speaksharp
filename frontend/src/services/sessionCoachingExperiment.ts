import { analyticsBuffer } from './AnalyticsBuffer';
import type { SpeakingScoreResult } from '@/utils/speakingScore';
import { SESSION_COACHING_VARIANTS, SESSION_COACHING_ASSIGNMENT_SOURCES } from './telemetryAllowlist';

export const SESSION_COACHING_EXPERIMENT_FLAG = 'session_live_coaching_score' as const;

// Bound to the telemetry vocabulary rather than declared independently: a variant that telemetry cannot
// express is a variant the experiment cannot measure, so adding one here without adding it there is a
// COMPILE error instead of a silently dropped analytics dimension.
export type SessionCoachingVariant = typeof SESSION_COACHING_VARIANTS[number];
export type SessionCoachingAssignmentSource = typeof SESSION_COACHING_ASSIGNMENT_SOURCES[number];

export interface SessionCoachingAssignment {
  variant: SessionCoachingVariant;
  source: SessionCoachingAssignmentSource;
  flag: typeof SESSION_COACHING_EXPERIMENT_FLAG;
}

export function getSessionCoachingAssignment(): SessionCoachingAssignment {
  return {
    variant: 'treatment',
    source: 'default',
    flag: SESSION_COACHING_EXPERIMENT_FLAG,
  };
}

export function trackSessionCoachingCardViewed(
  assignment: SessionCoachingAssignment,
  result: SpeakingScoreResult,
): void {
  analyticsBuffer.push('session_live_coaching_card_viewed', {
    experiment: SESSION_COACHING_EXPERIMENT_FLAG,
    variant: assignment.variant,
    assignment_source: assignment.source,
    model_version: result.modelVersion,
    confidence: result.confidence,
    score_band: result.label,
    numeric_score_visible: result.confidence !== 'warming-up',
    action_count: result.actions.length,
    weakest_categories: result.weakestCategories,
    transcription_engine: result.transcription.engine ?? 'unknown',
    transcription_confidence: result.transcription.confidence,
  }, 'LOW');
}

export function trackSessionCoachingNumericScoreShown(
  assignment: SessionCoachingAssignment,
  result: SpeakingScoreResult,
): void {
  analyticsBuffer.push('session_live_coaching_numeric_score_shown', {
    experiment: SESSION_COACHING_EXPERIMENT_FLAG,
    variant: assignment.variant,
    assignment_source: assignment.source,
    model_version: result.modelVersion,
    confidence: result.confidence,
    score_band: result.label,
    target_label: result.target.label,
    action_count: result.actions.length,
    weakest_categories: result.weakestCategories,
  }, 'LOW');
}

export function getSessionCoachingExperimentProperties(): Record<string, unknown> {
  const assignment = getSessionCoachingAssignment();
  return {
    session_coaching_experiment: SESSION_COACHING_EXPERIMENT_FLAG,
    session_coaching_variant: assignment.variant,
    session_coaching_assignment_source: assignment.source,
  };
}
