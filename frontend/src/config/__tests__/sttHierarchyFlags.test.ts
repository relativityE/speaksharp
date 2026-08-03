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
    resolveDefaultSttMode, STT_HIERARCHY_FLAG_KEY, sttFlagsReadyInitial,
} from '../sttHierarchyFlags';

type E2EWin = { __SS_E2E__?: { isActive: boolean; flags?: { sttPrivatePrimary?: boolean } } };
const setManifest = (m: E2EWin['__SS_E2E__'] | undefined) => {
    if (m === undefined) delete (window as unknown as E2EWin).__SS_E2E__;
    else (window as unknown as E2EWin).__SS_E2E__ = m;
};

// #1120 S1 (PR #1155) — bounded E2E-only hierarchy override (Option A). Resolves BEFORE PostHog and is
// prod-inert (only when the manifest is active + ENV.isE2E). Hierarchy only; never Cloud.
describe('#1120 S1 — bounded E2E hierarchy override', () => {
    beforeEach(() => { for (const k of Object.keys(flags)) delete flags[k]; });
    afterEach(() => setManifest(undefined));

    it('active manifest + true → launch ON, winning over a PostHog OFF (applied before the PostHog read)', () => {
        setManifest({ isActive: true, flags: { sttPrivatePrimary: true } });
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(true);
    });
    it('active manifest + false → rollback OFF, winning over a PostHog ON', () => {
        setManifest({ isActive: true, flags: { sttPrivatePrimary: false } });
        flags[STT_HIERARCHY_FLAG_KEY] = true;
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });
    it('undefined override → normal PostHog resolver governs', () => {
        setManifest({ isActive: true, flags: {} });
        flags[STT_HIERARCHY_FLAG_KEY] = true;
        expect(isPrivatePrimaryEnabled()).toBe(true);
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });
    it('INACTIVE manifest cannot override — the flag value is ignored, PostHog governs', () => {
        setManifest({ isActive: false, flags: { sttPrivatePrimary: true } });
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });
    it('no manifest at all (non-E2E) cannot override', () => {
        setManifest(undefined);
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });
    it('an active override makes flags ready at T=0 (no PostHog wait / strand)', () => {
        setManifest({ isActive: true, flags: { sttPrivatePrimary: true } });
        expect(sttFlagsReadyInitial()).toBe(true);
    });
});

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

    it('Cloud gate is the canonical VITE_CLOUD_STT_ENABLED exact-true env — fail-closed, independent of hierarchy', () => {
        // Hierarchy OFF/ON must not affect Cloud (the bug: rollback re-enabling Cloud, or hierarchy hiding it).
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        vi.stubEnv('VITE_CLOUD_STT_ENABLED', 'false');
        expect(isCloudSttEnabled()).toBe(false);
        expect(isCloudSttGloballyVisible()).toBe(false);
        vi.stubEnv('VITE_CLOUD_STT_ENABLED', 'true');
        expect(isCloudSttEnabled()).toBe(true);
        expect(isCloudSttGloballyVisible()).toBe(true);
        flags[STT_HIERARCHY_FLAG_KEY] = true; // hierarchy ON does not turn Cloud off
        expect(isCloudSttEnabled()).toBe(true);
        vi.stubEnv('VITE_CLOUD_STT_ENABLED', 'yes'); // any non-"true" value → fail-closed
        expect(isCloudSttEnabled()).toBe(false);
        vi.unstubAllEnvs();
    });

    it('a thrown PostHog read defaults the hierarchy OFF (fail-closed)', () => {
        isFeatureEnabled.mockImplementationOnce(() => { throw new Error('not ready'); });
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });

    it('resolveDefaultSttMode: Private only when the flag is ON AND the user can use Private', () => {
        expect(resolveDefaultSttMode(true, true)).toBe('private');
        expect(resolveDefaultSttMode(true, false)).toBe('native');
        expect(resolveDefaultSttMode(false, true)).toBe('native');
        expect(resolveDefaultSttMode(false, false)).toBe('native');
    });
});
