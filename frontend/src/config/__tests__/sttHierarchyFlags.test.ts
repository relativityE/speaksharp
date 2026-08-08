import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #1120 S1 — Private-primary hierarchy flag. Driven by PostHog per-key; OFF (fail-closed) on any error/unset.
const flags: Record<string, boolean | undefined> = {};
const isFeatureEnabled = vi.fn((k: string) => flags[k]);
vi.mock('posthog-js', () => ({
    default: {
        isFeatureEnabled: (k: string) => isFeatureEnabled(k),
        // onFeatureFlags present so sttFlagsReadyInitial() reports "wait for load" in this suite (unless a
        // bounded E2E override short-circuits it).
        onFeatureFlags: (cb: () => void) => { cb(); return () => {}; },
    },
}));

import {
    isPrivatePrimaryEnabled,
    resolveDefaultSttMode,
    STT_HIERARCHY_FLAG_KEY,
    sttFlagsReadyInitial,
} from '../sttHierarchyFlags';

type E2EWin = { __SS_E2E__?: { isActive: boolean; flags?: { sttPrivatePrimary?: boolean } } };
const setManifest = (m: E2EWin['__SS_E2E__'] | undefined) => {
    if (m === undefined) delete (window as unknown as E2EWin).__SS_E2E__;
    else (window as unknown as E2EWin).__SS_E2E__ = m;
};

// resolveDefaultSttMode is pure: Private only when the hierarchy is on AND the user can use Private.
describe('#1120 S1 — resolveDefaultSttMode', () => {
    it('is private only when private-primary AND can-use-private are both true', () => {
        expect(resolveDefaultSttMode(true, true)).toBe('private');
        expect(resolveDefaultSttMode(true, false)).toBe('native');
        expect(resolveDefaultSttMode(false, true)).toBe('native');
        expect(resolveDefaultSttMode(false, false)).toBe('native');
    });
});

// Bounded E2E-only hierarchy override: resolves BEFORE PostHog and is prod-inert (only when the manifest is
// active + ENV.isE2E). Hierarchy only.
describe('#1120 S1 — bounded E2E hierarchy override', () => {
    beforeEach(() => { for (const k of Object.keys(flags)) delete flags[k]; });
    afterEach(() => setManifest(undefined));

    it('active manifest + true → ON, winning over a PostHog OFF (applied before the PostHog read)', () => {
        setManifest({ isActive: true, flags: { sttPrivatePrimary: true } });
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(true);
    });
    it('active manifest + false → OFF, winning over a PostHog ON', () => {
        setManifest({ isActive: true, flags: { sttPrivatePrimary: true } });
        (window as unknown as E2EWin).__SS_E2E__!.flags!.sttPrivatePrimary = false;
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

describe('#1120 S1 — isPrivatePrimaryEnabled (PostHog)', () => {
    beforeEach(() => { for (const k of Object.keys(flags)) delete flags[k]; isFeatureEnabled.mockClear(); });
    afterEach(() => setManifest(undefined));

    it('hierarchy is ON only when its flag is exactly true; OFF for false/unset (fail-closed)', () => {
        flags[STT_HIERARCHY_FLAG_KEY] = true;
        expect(isPrivatePrimaryEnabled()).toBe(true);
        flags[STT_HIERARCHY_FLAG_KEY] = false;
        expect(isPrivatePrimaryEnabled()).toBe(false);
        delete flags[STT_HIERARCHY_FLAG_KEY]; // unresolved / undefined
        expect(isPrivatePrimaryEnabled()).toBe(false);
    });
});
