import { describe, it, expect, vi, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { isSessionOverhaulEnabled, SESSION_OVERHAUL_FLAG_KEY } from '../sessionOverhaulFlags';

// #1222 S11 — the overhaul flag defaults OFF and fails closed.
describe('sessionOverhaulFlags (#1222 S11)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('is OFF when PostHog has not enabled the flag', () => {
        vi.spyOn(posthog, 'isFeatureEnabled').mockReturnValue(false);
        expect(isSessionOverhaulEnabled()).toBe(false);
    });

    it('is ON only when the PostHog flag is enabled', () => {
        const spy = vi.spyOn(posthog, 'isFeatureEnabled').mockReturnValue(true);
        expect(isSessionOverhaulEnabled()).toBe(true);
        expect(spy).toHaveBeenCalledWith(SESSION_OVERHAUL_FLAG_KEY);
    });

    it('fails closed (OFF) when the flag read throws', () => {
        vi.spyOn(posthog, 'isFeatureEnabled').mockImplementation(() => { throw new Error('not ready'); });
        expect(isSessionOverhaulEnabled()).toBe(false);
    });
});
