import { describe, it, expect, afterEach } from 'vitest';
import { isSessionOverhaulEnabled } from '../sessionOverhaulFlags';

// #1222 — production defaults ON (no URL param); test builds default OFF so the legacy-page suites stay
// valid, unless the bounded E2E manifest override opts in.
describe('sessionOverhaulFlags (#1222)', () => {
    // The manifest override is only read when the E2E manifest is active (ENV.isE2E), so toggle isActive too.
    const m = () => (window as unknown as { __SS_E2E__?: { isActive?: boolean; flags?: Record<string, unknown> } }).__SS_E2E__;
    const setFlag = (v: boolean | undefined) => {
        const manifest = m();
        if (!manifest?.flags) return;
        if (v === undefined) { delete manifest.flags.sessionOverhaul; manifest.isActive = false; }
        else { manifest.flags.sessionOverhaul = v; manifest.isActive = true; }
    };
    afterEach(() => setFlag(undefined));

    it('defaults OFF under test so the legacy page (and its suites) stay in effect', () => {
        expect(isSessionOverhaulEnabled()).toBe(false);
    });

    it('the E2E manifest override turns it ON deterministically (the overhaul e2e path)', () => {
        setFlag(true);
        expect(isSessionOverhaulEnabled()).toBe(true);
    });

    it('the E2E manifest override can also force it OFF', () => {
        setFlag(false);
        expect(isSessionOverhaulEnabled()).toBe(false);
    });
});
