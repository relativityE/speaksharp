import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMock = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('../AnalyticsBuffer', () => ({
  analyticsBuffer: analyticsMock,
}));

import {
  getSessionCoachingExperimentProperties,
  getSessionCoachingAssignment,
} from '../sessionCoachingExperiment';

describe('sessionCoachingExperiment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it('always returns the live-coaching Session assignment', () => {
    expect(getSessionCoachingAssignment()).toEqual({
      variant: 'treatment',
      source: 'default',
      flag: 'session_live_coaching_score',
    });
  });

  it('includes live-coaching assignment in downstream analytics properties', () => {
    expect(getSessionCoachingExperimentProperties()).toEqual({
      session_coaching_experiment: 'session_live_coaching_score',
      session_coaching_variant: 'treatment',
      session_coaching_assignment_source: 'default',
    });
  });
});
