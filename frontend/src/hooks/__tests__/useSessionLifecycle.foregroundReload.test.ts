// #1258 return/reload contract: after a background idle reclamation the engine is NOT auto-reloaded; when the
// user returns to the foreground and the engine is at a clean idle/needs-load state, exactly one explicit
// reload is performed. `shouldReloadSttOnForegroundReturn` is the pure decision behind that visibilitychange
// handler.
import { describe, it, expect } from 'vitest';
import { shouldReloadSttOnForegroundReturn } from '../useSessionLifecycle';

const base = {
    visibilityState: 'visible' as DocumentVisibilityState,
    profileReadyForStt: true,
    sttMode: 'private' as const,
    isListening: false,
    shouldPromoteNativeDefaultToPrivate: false,
    runtimeState: 'IDLE',
};

describe('#1258 shouldReloadSttOnForegroundReturn', () => {
    it('RELOADS once when the user returns to a visible page and the engine was reclaimed to IDLE', () => {
        expect(shouldReloadSttOnForegroundReturn(base)).toBe(true);
    });

    it('RELOADS from a DOWNLOAD_REQUIRED (needs-load) state too', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, runtimeState: 'DOWNLOAD_REQUIRED' })).toBe(true);
    });

    it('does NOT reload while the page is still hidden (only on the visible transition)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, visibilityState: 'hidden' })).toBe(false);
    });

    it('does NOT reload a still-ready foreground-preserved engine (no reclaim→reload loop)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, runtimeState: 'READY' })).toBe(false);
    });

    it('does NOT reload while recording (never interrupt an active session)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, isListening: true, runtimeState: 'RECORDING' })).toBe(false);
    });

    it('does NOT reload before the profile is STT-ready or when no mode is selected', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, profileReadyForStt: false })).toBe(false);
        expect(shouldReloadSttOnForegroundReturn({ ...base, sttMode: null })).toBe(false);
    });

    it('does NOT reload while the native→private promotion is pending', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, shouldPromoteNativeDefaultToPrivate: true })).toBe(false);
    });
});
