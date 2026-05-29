import posthog from 'posthog-js';
import { analyticsBuffer } from './AnalyticsBuffer';
import type { SpeakingScoreResult } from '@/utils/speakingScore';

export const SESSION_COACHING_EXPERIMENT_FLAG = 'session_live_coaching_score' as const;

export type SessionCoachingVariant = 'control' | 'treatment';
export type SessionCoachingAssignmentSource = 'url' | 'posthog' | 'fallback';

export interface SessionCoachingAssignment {
  variant: SessionCoachingVariant;
  source: SessionCoachingAssignmentSource;
  flag: typeof SESSION_COACHING_EXPERIMENT_FLAG;
}

const STORAGE_KEY = 'speaksharp:session-live-coaching-assignment';

const normalizeVariant = (value: unknown): SessionCoachingVariant | null => {
  if (value === true || value === 'true' || value === 'on' || value === 'treatment') return 'treatment';
  if (value === false || value === 'false' || value === 'off' || value === 'control') return 'control';
  return null;
};

const getSearch = () => (typeof window === 'undefined' ? '' : window.location.search);

export function getSessionCoachingUrlOverride(search = getSearch()): SessionCoachingVariant | null {
  const value = new URLSearchParams(search).get('coaching');
  return normalizeVariant(value);
}

export function readStoredSessionCoachingAssignment(): SessionCoachingAssignment | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as SessionCoachingAssignment | null;
    return parsed?.flag === SESSION_COACHING_EXPERIMENT_FLAG && normalizeVariant(parsed.variant)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function storeSessionCoachingAssignment(assignment: SessionCoachingAssignment): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(assignment));
}

export function getFallbackSessionCoachingAssignment(): SessionCoachingAssignment {
  return {
    variant: 'control',
    source: 'fallback',
    flag: SESSION_COACHING_EXPERIMENT_FLAG,
  };
}

export function resolveSessionCoachingAssignment(search = getSearch()): SessionCoachingAssignment {
  const override = getSessionCoachingUrlOverride(search);
  if (override) {
    const assignment = {
      variant: override,
      source: 'url',
      flag: SESSION_COACHING_EXPERIMENT_FLAG,
    } satisfies SessionCoachingAssignment;
    storeSessionCoachingAssignment(assignment);
    return assignment;
  }

  const posthogVariant = normalizeVariant(
    typeof posthog.getFeatureFlag === 'function'
      ? posthog.getFeatureFlag(SESSION_COACHING_EXPERIMENT_FLAG)
      : null
  );
  if (posthogVariant) {
    const assignment = {
      variant: posthogVariant,
      source: 'posthog',
      flag: SESSION_COACHING_EXPERIMENT_FLAG,
    } satisfies SessionCoachingAssignment;
    storeSessionCoachingAssignment(assignment);
    return assignment;
  }

  const stored = readStoredSessionCoachingAssignment();
  if (stored) return stored;

  const fallback = getFallbackSessionCoachingAssignment();
  storeSessionCoachingAssignment(fallback);
  return fallback;
}

const getCurrentRoute = () => {
  if (typeof window === 'undefined') return 'unknown';
  return `${window.location.pathname}${window.location.search}`;
};

export function trackSessionCoachingExperimentViewed(assignment: SessionCoachingAssignment): void {
  if (assignment.source === 'fallback') return;

  analyticsBuffer.push('session_live_coaching_experiment_viewed', {
    experiment: SESSION_COACHING_EXPERIMENT_FLAG,
    variant: assignment.variant,
    assignment_source: assignment.source,
    route: getCurrentRoute(),
  }, 'LOW');
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
  const assignment = readStoredSessionCoachingAssignment() ?? getFallbackSessionCoachingAssignment();
  return {
    session_coaching_experiment: SESSION_COACHING_EXPERIMENT_FLAG,
    session_coaching_variant: assignment.variant,
    session_coaching_assignment_source: assignment.source,
  };
}
