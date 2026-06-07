/**
 * STT-IDENTITY-DIAG — dev/test-only debug gate.
 *
 * The STT identity badge is a manual-proof aid and MUST NOT appear for normal users. It is shown
 * only when explicitly enabled, via any of:
 *   - URL `?sttDebug=1` (or `true`)
 *   - `window.__STT_DEBUG__ === true` (set by the proof harness)
 *   - localStorage `speaksharp_stt_debug === '1'`
 * Default is OFF. Pure read; never throws.
 */
export const STT_DEBUG_STORAGE_KEY = 'speaksharp_stt_debug';

export function isSttDebugEnabled(
    win: Window | undefined = typeof window !== 'undefined' ? window : undefined,
): boolean {
    if (!win) return false;
    try {
        if ((win as unknown as { __STT_DEBUG__?: boolean }).__STT_DEBUG__ === true) return true;
        const q = new URLSearchParams(win.location.search).get('sttDebug');
        if (q === '1' || q === 'true') return true;
        if (win.localStorage?.getItem(STT_DEBUG_STORAGE_KEY) === '1') return true;
    } catch {
        /* ignore — default off */
    }
    return false;
}
