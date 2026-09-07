// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import {
    __resetRecordingIntentForTests,
    mintRecordingIntent,
    pendingRecordingIntent,
} from '../recordingIntent';
import { SpeechRuntimeController, type LifecycleToken } from '../SpeechRuntimeController';
import { sessionManager } from '../transcription/SessionManager';
import type { TranscriptionServiceOptions } from '../transcription/TranscriptionService';
import { completeSession } from '../../lib/storage';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    })),
}));

type PrivateController = {
    lifecycleVersion: number;
    state: string;
    isEngineReady: boolean;
    isEmissionsSafe: boolean;
    recordingStartedUnresolved: boolean;
    recordingEngineMode: string | null;
    service: unknown;
    callbacksForNewService: (callbacks?: Partial<TranscriptionServiceOptions>) => Partial<TranscriptionServiceOptions>;
    checkRecordingInvariant: (token?: LifecycleToken, intentToken?: string) => Promise<void>;
    transition: (
        state: string,
        error?: Error,
        token?: LifecycleToken,
        intentToken?: string,
    ) => Promise<void>;
    startRecording: SpeechRuntimeController['startRecording'];
    hardResetAwaited: SpeechRuntimeController['hardResetAwaited'];
    whenStable: SpeechRuntimeController['whenStable'];
};

const newController = (): PrivateController => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController;
};

const fakeService = (input: {
    isDestroyed: () => boolean;
    mode?: string;
    start?: () => Promise<void>;
    destroy?: () => Promise<void>;
}) => ({
    isServiceDestroyed: input.isDestroyed,
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue(input.mode ?? 'private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine',
        modelName: 'test-model',
        deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockImplementation(input.start ?? (() => Promise.resolve())),
    destroy: vi.fn().mockImplementation(input.destroy ?? (() => Promise.resolve())),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn(),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
});

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => { resolve = settle; });
    return { promise, resolve };
};

const POLICY = {
    allowNative: false,
    allowCloud: false,
    allowPrivate: true,
    preferredMode: 'private',
    allowFallback: false,
    executionIntent: 'test',
};

describe('#1431 — lifecycle work belongs to its originating attempt and service', () => {
    let controller: PrivateController;

    beforeEach(() => {
        vi.restoreAllMocks();
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('READY');
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready to record' });
        controller = newController();
        controller.state = 'READY';
    });

    it('lets B survive when A resolves from startTranscription after a hard reset', async () => {
        const aStart = deferred();
        let firstDestroyed = false;
        const serviceA = fakeService({
            isDestroyed: () => firstDestroyed,
            mode: 'mock',
            start: () => aStart.promise,
            destroy: async () => { firstDestroyed = true; },
        });
        const serviceB = fakeService({ isDestroyed: () => false, mode: 'private' });
        const services = [serviceA, serviceB];
        vi.spyOn(sessionManager, 'getOrCreateService').mockImplementation(() => services.shift() as never);

        controller.state = 'IDLE';
        useSessionStore.getState().setRuntimeState('IDLE');
        const attemptA = controller.startRecording(POLICY as never, []);
        const rejectedA = attemptA.catch((error: Error) => error.message);
        await vi.waitFor(() => expect(serviceA.startTranscription).toHaveBeenCalledTimes(1));

        await controller.hardResetAwaited('route_exit');
        const attemptB = controller.startRecording(POLICY as never, []);
        await expect(attemptB).resolves.toBeUndefined();
        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(controller.recordingEngineMode).toBe('private');
        expect(controller.service).toBe(serviceB);
        expect(pendingRecordingIntent()).toBeNull();

        aStart.resolve();
        await controller.whenStable();

        expect(await rejectedA).toBe('RECORDING_INTENT_RETIRED:teardown');
        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(controller.recordingEngineMode).toBe('private');
        expect(controller.service).toBe(serviceB);
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('rejects a stale lifecycle transition before controller or store mutation', async () => {
        const stale: LifecycleToken = { version: controller.lifecycleVersion, cancelled: false };
        controller.lifecycleVersion += 1;

        await controller.transition('INITIATING', undefined, stale);

        expect(controller.state).toBe('READY');
        expect(useSessionStore.getState().runtimeState).toBe('READY');
        expect(useSessionStore.getState().sttStatus).toMatchObject({
            type: 'idle',
            message: 'Ready to record',
        });
    });

    it('does not enter RECORDING when the supplied intent no longer owns the current start', async () => {
        const attemptA = mintRecordingIntent({
            recordingId: 'recording-a',
            policy: null,
            userWords: [],
        });
        const attemptB = mintRecordingIntent({
            recordingId: 'recording-b',
            policy: null,
            userWords: [],
        });
        controller.state = 'ENGINE_INITIALIZING';
        useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');
        controller.isEngineReady = true;
        controller.isEmissionsSafe = true;

        const startSession = vi.spyOn(useSessionStore.getState(), 'startSession');
        await controller.transition('RECORDING');
        await controller.transition('RECORDING', undefined, undefined, attemptA.token);

        expect(controller.state).toBe('ENGINE_INITIALIZING');
        expect(useSessionStore.getState().runtimeState).toBe('ENGINE_INITIALIZING');
        expect(controller.recordingStartedUnresolved).toBe(false);
        expect(pendingRecordingIntent()?.token).toBe(attemptB.token);
        expect(startSession).not.toHaveBeenCalled();

        await controller.checkRecordingInvariant(undefined, attemptB.token);

        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(startSession).toHaveBeenCalledTimes(1);
        expect(pendingRecordingIntent()).toBeNull();
    });

    it('ignores a late error callback from a service generation that has been replaced', async () => {
        let firstDestroyed = false;
        const first = fakeService({
            isDestroyed: () => firstDestroyed,
            destroy: async () => { firstDestroyed = true; },
        });
        const second = fakeService({ isDestroyed: () => false });
        const callbacksA = controller.callbacksForNewService();
        controller.service = first;

        controller.state = 'IDLE';
        useSessionStore.getState().setRuntimeState('IDLE');
        await controller.hardResetAwaited('replace_service');
        controller.callbacksForNewService();
        controller.service = second;
        const attemptB = mintRecordingIntent({
            recordingId: 'recording-b',
            policy: null,
            userWords: [],
        });
        controller.state = 'ENGINE_INITIALIZING';
        useSessionStore.getState().setRuntimeState('ENGINE_INITIALIZING');

        const preparingState = controller.state;
        const preparingStatus = useSessionStore.getState().sttStatus;
        const currentIntent = pendingRecordingIntent()?.token;
        callbacksA.onError?.(new Error('microphone permission denied by replaced service'));
        await controller.whenStable();
        expect(controller.state).toBe(preparingState);
        expect(useSessionStore.getState().sttStatus).toEqual(preparingStatus);
        expect(pendingRecordingIntent()?.token).toBe(currentIntent);
        expect(controller.service).toBe(second);
        expect(completeSession).not.toHaveBeenCalled();

        controller.isEngineReady = true;
        controller.isEmissionsSafe = true;
        await controller.checkRecordingInvariant(undefined, attemptB.token);
        const recordingStatus = useSessionStore.getState().sttStatus;
        callbacksA.onError?.(new Error('microphone permission denied by replaced service'));
        await controller.whenStable();

        expect(controller.state).toBe('RECORDING');
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
        expect(useSessionStore.getState().sttStatus).toEqual(recordingStatus);
        expect(controller.service).toBe(second);
        expect(completeSession).not.toHaveBeenCalled();
    });
});
