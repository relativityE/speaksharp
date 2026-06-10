import { describe, expect, it } from 'vitest';
import { canShowFreePlanSupport } from '../freePlanSupport';

describe('canShowFreePlanSupport', () => {
  it('shows only for enabled Free users on allowed low-sensitivity surfaces', () => {
    expect(canShowFreePlanSupport({
      enabled: true,
      tier: 'free',
      placement: 'pricing-inline',
      route: '/pricing',
    })).toBe(true);
  });

  it('keeps free-plan support off paid Basic and Pro tiers', () => {
    for (const tier of ['basic', 'pro'] as const) {
      expect(canShowFreePlanSupport({
        enabled: true,
        tier,
        placement: 'pricing-inline',
        route: '/pricing',
      })).toBe(false);
    }
  });

  it('blocks sensitive practice and personal review surfaces', () => {
    expect(canShowFreePlanSupport({
      enabled: true,
      tier: 'free',
      placement: 'analytics-overview-sidebar',
      route: '/session',
    })).toBe(false);
    expect(canShowFreePlanSupport({
      enabled: true,
      tier: 'free',
      placement: 'analytics-overview-sidebar',
      route: '/analytics/session-1',
    })).toBe(false);
    expect(canShowFreePlanSupport({
      enabled: true,
      tier: 'free',
      placement: 'pricing-inline',
      route: '/export/session-1',
    })).toBe(false);
  });

  it('honors recording and kill-switch protections', () => {
    expect(canShowFreePlanSupport({
      enabled: false,
      tier: 'free',
      placement: 'pricing-inline',
      route: '/pricing',
    })).toBe(false);
    expect(canShowFreePlanSupport({
      enabled: true,
      tier: 'free',
      placement: 'post-session-footer',
      route: '/session',
      isRecording: true,
    })).toBe(false);
  });
});
