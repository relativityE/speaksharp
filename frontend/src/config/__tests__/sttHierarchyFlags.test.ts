import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1120 S1 — hierarchy + INDEPENDENT Cloud gate. Driven by PostHog per-key; OFF (fail-closed) on any error/unset.
const flags: Record<string, boolean | undefined> = {};
const isFeatureEnabled = vi.fn((k: string) => flags[k]);
vi.mock('posthog-js', () => ({
    default: {
        isFeatureEnabled: (k: string) => isFeatureEnabled(k),
        // onFeatureFlags present so sttFlagsReadyInitial() reports "wait for load" in this suite.
        onFeatureFlags: (cb: () => void) => { cb(); return () => {}; },
    },
}));

import {
    isPrivatePrimaryEnabled, isCloudSttEnabled, isCloudSttGloballyVisible,
    resolveDefaultSttMode, STT_HIERARCHY_FLAG_KEY, CLOUD_STT_FLAG_KEY,
} from '../sttHierarchyFlags';

describe('#1120 S1 sttHierarchyFlags', () => {
    beforeEach(() => { for (const k of Object.keys(flags)) delete flags[k]; isFeatureEnabled.mockClear(); });

    it('hierarchy is ON only when its flag is exactly true', () => {
        flags[STT_HIERARCHY_FLAG_KEY] = true;
        expect(isPrivatePrimaryEnabled()).toBe(true);
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(false);
        delete flags[STT_HIERARCHY_FLAG_KEY]; // unresolved/undefined
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });

    it('Cloud gate is INDEPENDENT + fail-closed — never coupled to the hierarchy flag', () => {
        // Hierarchy OFF must NOT grant Cloud (the bug: rollback re-enabling Cloud).
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isCloudSttEnabled()).toBe(false);
        expect(isCloudSttGloballyVisible()).toBe(false);
        // Cloud is on ONLY when its own flag is exactly true, regardless of hierarchy.
        flags[CLOUD_STT_FLAG_KEY] = true;
        expect(isCloudSttEnabled()).toBe(true);
        expect(isCloudSttGloballyVisible()).toBe(true);
        // Hierarchy ON does not turn Cloud off if Cloud's own flag is on (fully decoupled).
        flags[STT_HIERARCHY_FLAG_KEY] = true;
        expect(isCloudSttEnabled()).toBe(true);
    });

    it('a thrown PostHog read defaults everything OFF (fail-closed)', () => {
        isFeatureEnabled.mockImplementationOnce(() => { throw new Error('not ready'); });
        expect(isPrivatePrimaryEnabled()).toBe(false);
        isFeatureEnabled.mockImplementationOnce(() => { throw new Error('not ready'); });
        expect(isCloudSttEnabled()).toBe(false);
    });

    it('resolveDefaultSttMode: Private only when the flag is ON AND the user can use Private', () => {
        expect(resolveDefaultSttMode(true, true)).toBe('private');
        expect(resolveDefaultSttMode(true, false)).toBe('native');
        expect(resolveDefaultSttMode(false, true)).toBe('native');
        expect(resolveDefaultSttMode(false, false)).toBe('native');
    });
});
