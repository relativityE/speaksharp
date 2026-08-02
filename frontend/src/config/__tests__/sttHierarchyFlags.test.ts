import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1120 S1 — the master hierarchy flag. Driven by PostHog; OFF (today's behavior) on any error/unset.
const isFeatureEnabled = vi.fn();
vi.mock('posthog-js', () => ({ default: { isFeatureEnabled: (k: string) => isFeatureEnabled(k) } }));

import { isPrivatePrimaryEnabled, isCloudSttGloballyVisible, resolveDefaultSttMode, STT_HIERARCHY_FLAG_KEY } from '../sttHierarchyFlags';

describe('#1120 S1 sttHierarchyFlags', () => {
    beforeEach(() => { isFeatureEnabled.mockReset(); });

    it('is ON only when the PostHog flag returns exactly true', () => {
        isFeatureEnabled.mockReturnValue(true);
        expect(isPrivatePrimaryEnabled()).toBe(true);
        expect(isFeatureEnabled).toHaveBeenCalledWith(STT_HIERARCHY_FLAG_KEY);
    });

    it('is OFF (today) when the flag is false, undefined, or throws', () => {
        isFeatureEnabled.mockReturnValue(false);
        expect(isPrivatePrimaryEnabled()).toBe(false);
        isFeatureEnabled.mockReturnValue(undefined);
        expect(isPrivatePrimaryEnabled()).toBe(false);
        isFeatureEnabled.mockImplementation(() => { throw new Error('posthog not ready'); });
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });

    it('Cloud visibility is the inverse of the hierarchy flag (Cloud hidden when S1 is ON)', () => {
        isFeatureEnabled.mockReturnValue(true);
        expect(isCloudSttGloballyVisible()).toBe(false);
        isFeatureEnabled.mockReturnValue(false);
        expect(isCloudSttGloballyVisible()).toBe(true);
    });

    it('resolveDefaultSttMode: Private only when the flag is ON AND the user can use Private', () => {
        expect(resolveDefaultSttMode(true, true)).toBe('private');   // S1 on + entitled → Private primary
        expect(resolveDefaultSttMode(true, false)).toBe('native');   // no Private access → Browser
        expect(resolveDefaultSttMode(false, true)).toBe('native');   // flag off (today) → Browser
        expect(resolveDefaultSttMode(false, false)).toBe('native');
    });
});
