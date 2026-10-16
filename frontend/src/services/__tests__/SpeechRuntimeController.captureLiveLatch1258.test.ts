// @vitest-environment jsdom
/**
 * #1258 C10 — ONE current-attempt definition of "recording begins" (PM 6204464608): `captureLive` follows the Private
 * engine's real-frame readiness, never the FSM name alone. A same-attempt signal that arrives BEFORE the RECORDING
 * transition is kept; a superseded service's signal is rejected; Stop/reset/new Start clear it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { completeSession, saveSession } from '../../lib/storage';
import { __resetRecordingIntentForTests } from '../recordingIntent';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

type FakeService = {
    isServiceDestroyed: () => boolean;
    updateCallbacks: (callbacks: Partial<TranscriptionServiceOptions>) => void;
};

const factory = vi.hoisted(() => ({
    queue: [] as FakeService[],
    active: null as FakeService | null,
}));

vi.mock('@/services/transcription/TranscriptionService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/transcription/TranscriptionService')>();
    return {
        ...actual,
        // SessionManager's contract: reuse the cached service unless it is destroyed.
        getTranscriptionService: vi.fn((callbacks: Partial<TranscriptionServiceOptions>) => {
            if (factory.active && !factory.active.isServiceDestroyed()) {
                factory.active.updateCallbacks(callbacks);
                return factory.active;
            }
            const next = factory.queue.shift();
            if (!next) throw new Error('test harness: no service queued for this take');
            next.updateCallbacks(callbacks);
            factory.active = next;
            return next;
        }),
    };
});
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn(),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: vi.fn().mockResolvedValue({ ok: true, coverage: [] }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    })),
}));


type PrivateController = {
    state: string;
    service: unknown;
    serviceGeneration: number;
    acceptedAttempt: { recordingId: string; service: unknown } | null;
    recordingProgressMode: { mode: string };
    startRecording: (policy: unknown, words: string[]) => Promise<unknown>;
    stopRecording: () => Promise<unknown>;
    discardUnresolvedRecording: () => Promise<{ outcome: string }>;
};

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

/**
 * Shaped like the real service after a clean engine stop: READY, not destroyed, strategy kept. It is
 * destroyed — terminal — only once `destroy()` has resolved; `live` is the binding its engine emits through.
 */
const recordingService = (name: string) => {
    const svc = {
    name,
    destroyed: false,
    live: {} as Partial<TranscriptionServiceOptions>,
    isServiceDestroyed: vi.fn(() => svc.destroyed),
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine', modelName: 'test-model', deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    getStartTime: vi.fn().mockReturnValue(Date.now() - 5_000),
    // The engine stopped and returned its final: the failure that follows is the SAVE, not the engine.
    stopTranscription: vi.fn().mockResolvedValue({
        success: true, transcript: 'Alpha take words.', stats: { total_words: 3, accuracy: 1 },
    }),
    // Terminal only AFTER an asynchronous engine termination, as `TranscriptionService.destroy()` is.
    destroy: vi.fn(async () => { await Promise.resolve(); svc.destroyed = true; }),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn((callbacks: Partial<TranscriptionServiceOptions>) => { svc.live = callbacks; }),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
    };
    return svc;
};

const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

describe('#1258 C10 — captureLive latch', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(saveSession).mockReset().mockResolvedValue({ status: 'saved', session: { id: 'session-x' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });
    const live = () => useSessionStore.getState().captureLive;

    it('RECORDING without a real-frame signal is NOT live; the engine\'s readiness makes it live', async () => {
        const c = newController();
        c.state = 'READY';
        const a = recordingService('A');
        factory.queue.push(a);
        await c.startRecording(POLICY, []);
        expect(c.state).toBe('RECORDING');
        expect(live(), 'the FSM state alone does not make the take live').toBe(false);
        a.live.onStatusChange?.({ type: 'recording', message: 'Speak now' } as never);
        expect(live()).toBe(true);
        a.live.onStatusChange?.({ type: 'warming', message: 'Starting…' } as never);
        expect(live(), 'warming withdraws it').toBe(false);
    });

    it('a same-attempt signal that arrives BEFORE the RECORDING transition is kept', async () => {
        const c = newController();
        c.state = 'READY';
        const a = recordingService('A');
        a.startTranscription.mockImplementation(async () => {
            a.live.onStatusChange?.({ type: 'recording', message: 'Speak now' } as never); // during ENGINE_INITIALIZING
        });
        factory.queue.push(a);
        await c.startRecording(POLICY, []);
        expect(c.state).toBe('RECORDING');
        expect(live(), 'the early real-frame signal is honoured at RECORDING').toBe(true);
    });

    it('Stop clears it, and a superseded take\'s late signal cannot make the next take live', async () => {
        const c = newController();
        c.state = 'READY';
        const a = recordingService('A');
        const b = recordingService('B');
        factory.queue.push(a, b);
        await c.startRecording(POLICY, []);
        const callbacksA = a.live;
        callbacksA.onStatusChange?.({ type: 'recording', message: 'Speak now' } as never);
        expect(live()).toBe(true);
        await c.stopRecording();
        await settle();
        expect(live(), 'Stop ends live capture').toBe(false);
        useSessionStore.getState().setProgressGate(null);
        window.localStorage.clear();
        await c.startRecording(POLICY, []);
        expect(c.acceptedAttempt?.service).toBe(b);
        callbacksA.onStatusChange?.({ type: 'recording', message: 'Speak now' } as never); // A's engine, late
        expect(live(), 'a superseded engine cannot vouch for the new take').toBe(false);
        b.live.onStatusChange?.({ type: 'recording', message: 'Speak now' } as never);
        expect(live(), 'POSITIVE CONTROL: the current engine can').toBe(true);
    });

    it('PM 6205858358: a non-Private engine at RECORDING is NOT live, even when it reports a recording status', async () => {
        const c = newController();
        c.state = 'READY';
        const a = recordingService('A');
        a.getMode.mockReturnValue('native');
        factory.queue.push(a);
        await c.startRecording(POLICY, []);
        expect(c.state).toBe('RECORDING');
        expect(live(), 'no non-Private FSM shortcut').toBe(false);
        a.live.onStatusChange?.({ type: 'recording', message: 'Recording active' } as never);
        expect(live(), 'only the Private readiness signal counts').toBe(false);
    });

    it('PM 6205858358: an unknown mode is NOT live at RECORDING', async () => {
        const c = newController();
        c.state = 'READY';
        const a = recordingService('A');
        a.getMode.mockReturnValue(undefined);
        factory.queue.push(a);
        await c.startRecording(POLICY, []);
        expect(c.state).toBe('RECORDING');
        expect(live()).toBe(false);
    });
});
