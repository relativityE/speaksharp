import { describe, it, expect, vi, afterEach } from 'vitest';
import posthog from 'posthog-js';
import { isSessionOverhaulEnabled, SESSION_OVERHAUL_FLAG_KEY } from '../sessionOverhaulFlags';

// #1222 S11 — the overhaul flag defaults OFF and fails closed; a per-browser ?overhaul override wins.
describe('sessionOverhaulFlags (#1222 S11)', () => {
    afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

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

    it('a sticky ?overhaul override wins over the PostHog flag (reviewer sees it immediately)', () => {
        // Simulate a prior ?overhaul=1 visit having stored the sticky override.
        localStorage.setItem('speaksharp_session_overhaul_override', '1');
        vi.spyOn(posthog, 'isFeatureEnabled').mockReturnValue(false); // rollout still OFF
        expect(isSessionOverhaulEnabled()).toBe(true);

        localStorage.setItem('speaksharp_session_overhaul_override', '0');
        vi.spyOn(posthog, 'isFeatureEnabled').mockReturnValue(true); // rollout ON, but user opted out
        expect(isSessionOverhaulEnabled()).toBe(false);
    });
});
