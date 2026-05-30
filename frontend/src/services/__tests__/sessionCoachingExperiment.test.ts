import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMock = vi.hoisted(() => ({
  push: vi.fn(),
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
  });

  it('lets URL overrides force the live coaching page for manual QA', () => {
    expect(getSessionCoachingUrlOverride('?coaching=on')).toBe('treatment');
    expect(getSessionCoachingUrlOverride('?coaching=off')).toBeNull();
  });

  it('defaults to treatment when no URL override is present', () => {
    expect(resolveSessionCoachingAssignment('').variant).toBe('treatment');
    expect(resolveSessionCoachingAssignment('').source).toBe('fallback');
  });

  it('uses URL override ahead of the product default', () => {
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
    resolveSessionCoachingAssignment('?coaching=on');

    expect(getSessionCoachingExperimentProperties()).toEqual({
      session_coaching_experiment: 'session_live_coaching_score',
      session_coaching_variant: 'treatment',
      session_coaching_assignment_source: 'url',
    });
  });
});
