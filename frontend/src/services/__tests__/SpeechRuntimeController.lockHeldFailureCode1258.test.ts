// @vitest-environment jsdom
/**
 * #1258 (Codex P2 4261513195, PM 6150665406) — A START REFUSED BECAUSE ANOTHER TAB HOLDS THE RECORDING LOCK SAYS WHICH
 * FAILURE IT WAS.
 *
 * When `lock.acquire('INITIATING')` returned false the controller transitioned to FAILED with no error, so the emitted
 * `recording_state` carried no `failure_code` — the lock race stayed indistinguishable from the old "Error" baseline.
 * These drive the REAL start path (harness from the #1604 duplicate-Stop suite; only the service factory, network and
 * server are stubbed) with the lock held elsewhere, and read the event the controller actually emits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { completeSession, saveSession } from '../../lib/storage';
import { __resetRecordingIntentForTests } from '../recordingIntent';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { DistributedLock } from '@/lib/DistributedLock';
import { emitRecordingState } from '@/services/telemetry/journeyEvents';
import { RECORDING_FAILURE_CODES, recordingFailureCode } from '../recordingFailureCode';

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
vi.mock('@/services/telemetry/journeyEvents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/telemetry/journeyEvents')>();
    return { ...actual, emitRecordingState: vi.fn() };
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

/** Every recording_state the controller emitted, as [from, to, cause, failureCode]. */
const emitted = () => vi.mocked(emitRecordingState).mock.calls.map((call) => [call[0], call[1], call[2], call[3] ?? null]);

const startWith = async (lockAcquired: boolean) => {
    vi.spyOn(DistributedLock.prototype, 'acquire').mockReturnValue(lockAcquired);
    const c = newController() as PrivateController & Record<string, unknown>;
    c.state = 'READY';
    factory.queue.push(recordingService('A'));
    await c.startRecording(POLICY, []).catch(() => undefined);
    await settle();
    return c;
};

describe('#1258 — a Start refused because another tab holds the recording lock', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        factory.queue.length = 0;
        factory.active = null;
        vi.mocked(emitRecordingState).mockClear();
        vi.restoreAllMocks();
        vi.mocked(saveSession).mockReset().mockResolvedValue({ status: 'saved', session: { id: 'session-A' } } as never);
        vi.mocked(completeSession).mockReset().mockResolvedValue({ success: true } as never);
    });

    it('the FAILED transition carries failure_code start_gate_closed, and never the display text', async () => {
        await startWith(false);
        const failed = emitted().filter(([, to]) => to === 'FAILED');
        expect(failed, 'exactly one FAILED transition').toHaveLength(1);
        expect(failed[0][3]).toBe('start_gate_closed');
        expect(RECORDING_FAILURE_CODES).toContain(failed[0][3]);
        expect(JSON.stringify(emitted()), 'the display text never becomes telemetry').not.toMatch(/another tab/i);
        // The user still sees the same message as before; only telemetry changed.
        expect(useSessionStore.getState().sttStatus).toMatchObject({ type: 'error', message: '⛔ Active session in another tab.' });
    });

    it('CONTROL: a Start that acquires the lock emits no FAILED transition, and no non-FAILED event carries a code', async () => {
        await startWith(true);
        expect(emitted().filter(([, to]) => to === 'FAILED')).toEqual([]);
        expect(emitted().length, 'the start path did emit transitions').toBeGreaterThan(0);
        expect(emitted().filter(([, , , code]) => code !== null)).toEqual([]);
    });

    it('CONTROL: an unknown non-null error still maps only to `other`', () => {
        expect(recordingFailureCode(new Error('something nobody authored'))).toBe('other');
    });
});
