import { beforeEach, describe, expect, it, vi } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  getFeatureFlag: vi.fn(),
}));

const analyticsMock = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: posthogMock,
}));

vi.mock('../AnalyticsBuffer', () => ({
  analyticsBuffer: analyticsMock,
}));

import {
  getSessionCoachingExperimentProperties,
  getSessionCoachingUrlOverride,
  resolveSessionCoachingAssignment,
  trackSessionCoachingExperimentViewed,
} from '../sessionCoachingExperiment';

describe('sessionCoachingExperiment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    posthogMock.getFeatureFlag.mockReturnValue(null);
  });

  it('lets URL overrides force treatment and control for manual QA', () => {
    expect(getSessionCoachingUrlOverride('?coaching=on')).toBe('treatment');
    expect(getSessionCoachingUrlOverride('?coaching=off')).toBe('control');
  });

  it('prefers PostHog assignment when no URL override is present', () => {
    posthogMock.getFeatureFlag.mockReturnValue('treatment');

    expect(resolveSessionCoachingAssignment('').variant).toBe('treatment');
    expect(resolveSessionCoachingAssignment('').source).toBe('posthog');
  });

  it('uses URL override ahead of PostHog assignment', () => {
    posthogMock.getFeatureFlag.mockReturnValue('control');

    expect(resolveSessionCoachingAssignment('?coaching=on')).toEqual({
      variant: 'treatment',
      source: 'url',
      flag: 'session_live_coaching_score',
    });
  });

  it('does not emit exposure analytics for fallback assignment', () => {
    const assignment = resolveSessionCoachingAssignment('');

    expect(assignment.source).toBe('fallback');
    trackSessionCoachingExperimentViewed(assignment);
    expect(analyticsMock.push).not.toHaveBeenCalled();
  });

  it('includes stored assignment in downstream analytics properties', () => {
    posthogMock.getFeatureFlag.mockReturnValue('control');
    resolveSessionCoachingAssignment('');

    expect(getSessionCoachingExperimentProperties()).toEqual({
      session_coaching_experiment: 'session_live_coaching_score',
      session_coaching_variant: 'control',
      session_coaching_assignment_source: 'posthog',
    });
  });
});
