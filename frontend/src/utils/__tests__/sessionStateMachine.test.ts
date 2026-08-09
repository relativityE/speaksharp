import { describe, it, expect } from 'vitest';
import { resolveSessionState } from '../sessionStateMachine';

// #1222 §4 — the transition to `during` triggers on the FIRST AUDIO FRAME, not the click.
describe('resolveSessionState (#1222 §4)', () => {
    it('idle → before', () => {
        expect(resolveSessionState({ firstAudioFrameReceived: false, stopped: false })).toBe('before');
    });

    it('first audio frame → during', () => {
        expect(resolveSessionState({ firstAudioFrameReceived: true, stopped: false })).toBe('during');
    });

    it('a failed start (permission denied, no audio) STAYS in before — the layout must not collapse', () => {
        expect(resolveSessionState({ firstAudioFrameReceived: false, stopped: false, permissionError: true })).toBe('before');
    });

    it('stopped → after', () => {
        expect(resolveSessionState({ firstAudioFrameReceived: true, stopped: true })).toBe('after');
    });

    it('a late permission error after audio already flowed does not un-collapse a live/stopped session', () => {
        expect(resolveSessionState({ firstAudioFrameReceived: true, stopped: false, permissionError: true })).toBe('during');
        expect(resolveSessionState({ firstAudioFrameReceived: true, stopped: true, permissionError: true })).toBe('after');
    });
});
