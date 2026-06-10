// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { collectSttIdentityFromWindow } from '../sttIdentity';
import { PRIVATE_ENGINE_OVERRIDE_KEY } from '../sttConstants';

/**
 * Reviewer fix #2 (diagnostic drift): `sttIdentity` must read the private-engine
 * override from the SAME localStorage key as `PrivateSTT`. Both now import the single
 * source `PRIVATE_ENGINE_OVERRIDE_KEY`, so the debug identity can no longer lie about a
 * localStorage-forced engine. These tests pin that behavior through the window reader.
 */
type DebugWin = { __SPEECH_RUNTIME_DEBUG__?: () => unknown };

describe('sttIdentity engine-override read uses the single-sourced key (no drift vs PrivateSTT)', () => {
    afterEach(() => {
        window.localStorage.clear();
        delete (window as unknown as DebugWin).__SPEECH_RUNTIME_DEBUG__;
        try { window.history.replaceState({}, '', '/'); } catch { /* happy-dom reset */ }
    });

    it('the shared key is the dotted production key', () => {
        expect(PRIVATE_ENGINE_OVERRIDE_KEY).toBe('speaksharp.private.engine');
    });

    it('reads the override from the SHARED key PrivateSTT uses -> engineSelection "override"', () => {
        (window as unknown as DebugWin).__SPEECH_RUNTIME_DEBUG__ = () => ({ serviceMode: 'private' });
        window.localStorage.setItem(PRIVATE_ENGINE_OVERRIDE_KEY, 'transformers-js-v4');

        const id = collectSttIdentityFromWindow(window);
        expect(id.engineSelection).toBe('override');
    });

    it('does NOT read the stale underscore key (drift fixed: old key is inert)', () => {
        (window as unknown as DebugWin).__SPEECH_RUNTIME_DEBUG__ = () => ({ serviceMode: 'private' });
        window.localStorage.setItem('speaksharp_private_engine_override', 'transformers-js-v4');

        const id = collectSttIdentityFromWindow(window);
        expect(id.engineSelection).toBe('default'); // stale key ignored -> debug identity no longer lies
    });
});
