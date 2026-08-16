// #1258 return/reload contract: after a genuine idle reclamation the engine is NOT auto-reloaded; when the
// user returns to the foreground and an ACTUAL reclamation occurred while away, exactly one explicit reload is
// performed. `shouldReloadSttOnForegroundReturn` is the pure decision behind that visibilitychange handler.
// The authorizing signal is `hasPendingReclamation` (a change in the controller-owned reclamation token) —
// never a generic IDLE state or a quick tab switch.
import { describe, it, expect } from 'vitest';
import { shouldReloadSttOnForegroundReturn } from '../useSessionLifecycle';

const base = {
    visibilityState: 'visible' as DocumentVisibilityState,
    profileReadyForStt: true,
    // The EFFECTIVE mode — Private-only resolves `sttMode ?? 'private'`, so this is 'private' even when the
    // store `sttMode` is null (the real production condition).
    effectiveMode: 'private' as const,
    isListening: false,
    shouldPromoteNativeDefaultToPrivate: false,
    hasPendingReclamation: true,
};

describe('#1258 shouldReloadSttOnForegroundReturn', () => {
    it('RELOADS once when the user returns visible AND an actual reclamation occurred while away', () => {
        expect(shouldReloadSttOnForegroundReturn(base)).toBe(true);
    });

    it('RELOADS with the effective private mode even though the raw store sttMode is null (canary condition)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, effectiveMode: 'private' })).toBe(true);
    });

    it('does NOT reload without a pending reclamation — a mere tab switch reclaimed nothing', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, hasPendingReclamation: false })).toBe(false);
    });

    it('does NOT reload while the page is still hidden (only on the visible transition)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, visibilityState: 'hidden' })).toBe(false);
    });

    it('does NOT reload while recording (never interrupt an active session)', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, isListening: true })).toBe(false);
    });

    it('does NOT reload before the profile is STT-ready or when no effective mode resolves', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, profileReadyForStt: false })).toBe(false);
        expect(shouldReloadSttOnForegroundReturn({ ...base, effectiveMode: null })).toBe(false);
    });

    it('does NOT reload while the native→private promotion is pending', () => {
        expect(shouldReloadSttOnForegroundReturn({ ...base, shouldPromoteNativeDefaultToPrivate: true })).toBe(false);
    });
});
