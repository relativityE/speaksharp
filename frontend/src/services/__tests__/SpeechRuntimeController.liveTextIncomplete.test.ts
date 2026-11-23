// @vitest-environment jsdom
/**
 * J3.b — the live-text-incomplete notice is latched per take at the controller's store boundary.
 *
 * Private marks its live updates once a live decode dropped audio. The controller latches that for the current take
 * only: a later clean update does not clear it, an update arriving outside RECORDING (a late update from a stopped
 * take) never sets it, and the next take's reset clears it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptUpdate } from '@/types/transcription';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));

type Internals = {
    state: string;
    initialized: boolean;
    isEngineReady: boolean;
    isEmissionsSafe: boolean;
    isSubscriberReady: boolean;
    emissionQueue: TranscriptUpdate[];
    subscriberCallbacks: Record<string, unknown>;
    handleTranscriptUpdate: (u: TranscriptUpdate) => void;
    resetAnalysisStateForNewRecording: () => void;
};

describe('J3.b — live-text-incomplete latch (controller → store)', () => {
    let c: Internals;
    const latched = () => useSessionStore.getState().liveTextIncomplete;

    beforeEach(() => {
        localStorage.clear();
        c = SpeechRuntimeController.getInstance() as unknown as Internals;
        c.state = 'RECORDING';
        c.initialized = true;
        c.isEngineReady = true;
        c.isEmissionsSafe = true;
        c.emissionQueue = [];
        c.isSubscriberReady = true;
        c.subscriberCallbacks = { onTranscriptUpdate: vi.fn() };
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
    });

    it('a clean take never shows the notice', () => {
        c.handleTranscriptUpdate({ transcript: { final: 'first words of the take' } });
        c.handleTranscriptUpdate({ transcript: { partial: 'and a bit more' } });
        expect(latched()).toBe(false);
    });

    it('latches on the first marked update and stays latched through later clean updates in the same take', () => {
        c.handleTranscriptUpdate({ transcript: { final: 'words before the gap' } });
        expect(latched()).toBe(false);
        c.handleTranscriptUpdate({ transcript: { final: 'words after the gap', liveTextIncomplete: true } });
        expect(latched()).toBe(true);
        c.handleTranscriptUpdate({ transcript: { partial: 'a clean later partial' } });
        expect(latched()).toBe(true);
    });

    it.each(['STOPPING', 'IDLE', 'READY'])('a marked update arriving in %s (outside RECORDING) never sets it', (state) => {
        c.state = state;
        c.handleTranscriptUpdate({ transcript: { final: 'late words', liveTextIncomplete: true } });
        expect(latched()).toBe(false);
    });

    it('a flag-only update (capped decode, no text) latches the notice without reaching subscribers or the transcript', () => {
        const onTranscriptUpdate = vi.fn();
        c.subscriberCallbacks = { onTranscriptUpdate };
        useSessionStore.getState().updateTranscript('Words so far.', '');
        c.handleTranscriptUpdate({ transcript: { liveTextIncomplete: true } });
        expect(latched()).toBe(true);
        expect(onTranscriptUpdate).not.toHaveBeenCalled();
        expect(c.emissionQueue).toHaveLength(0);
        expect(useSessionStore.getState().transcript).toEqual({ transcript: 'Words so far.', partial: '' });
    });

    it('a flag-only update outside RECORDING never sets it', () => {
        c.state = 'STOPPING';
        c.handleTranscriptUpdate({ transcript: { liveTextIncomplete: true } });
        expect(latched()).toBe(false);
    });

    it('the next take starts without the notice', () => {
        c.handleTranscriptUpdate({ transcript: { final: 'gap take words', liveTextIncomplete: true } });
        expect(latched()).toBe(true);
        c.resetAnalysisStateForNewRecording();
        expect(latched()).toBe(false);
    });
});
