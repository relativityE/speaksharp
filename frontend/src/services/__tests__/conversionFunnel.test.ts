import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMock = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('../AnalyticsBuffer', () => ({
  analyticsBuffer: analyticsMock,
}));

vi.mock('../sessionCoachingExperiment', () => ({
  getSessionCoachingExperimentProperties: () => ({
    session_coaching_experiment: 'session_live_coaching_score',
    session_coaching_variant: 'treatment',
    session_coaching_assignment_source: 'posthog',
  }),
}));

import { trackCheckoutStarted, trackConversionCtaClicked } from '../conversionFunnel';

describe('conversionFunnel experiment attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds live-coaching experiment properties to conversion CTA clicks', () => {
    trackConversionCtaClicked({ source: 'nav_upgrade', plan: 'pro' });

    expect(analyticsMock.push).toHaveBeenCalledWith(
      'conversion_cta_clicked',
      expect.objectContaining({
        source: 'nav_upgrade',
        plan: 'pro',
        session_coaching_experiment: 'session_live_coaching_score',
        session_coaching_variant: 'treatment',
        session_coaching_assignment_source: 'posthog',
      }),
      'HIGH',
    );
  });

  it('adds live-coaching experiment properties to checkout starts', () => {
    trackCheckoutStarted({ source: 'pricing_pro_card', plan: 'pro' });

    expect(analyticsMock.push).toHaveBeenCalledWith(
      'checkout_started',
      expect.objectContaining({
        source: 'pricing_pro_card',
        plan: 'pro',
        session_coaching_variant: 'treatment',
      }),
      'HIGH',
    );
  });
});
