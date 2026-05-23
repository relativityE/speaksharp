// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';

vi.mock('../../lib/logger', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn(),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } })
        }
    }))
}));

describe('SpeechRuntimeController State Truth & Guards', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        
        // Reset singleton private state
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = false;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = false;

        const stubService = {
            updatePolicy: vi.fn().mockResolvedValue(undefined),
            warmUp: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('native'),
            getStrategy: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
            fsm: { is: vi.fn().mockReturnValue(false) },
            subscribe: vi.fn(() => vi.fn()),
            destroy: async () => {},
            isServiceDestroyed: () => false,
            startTranscription: vi.fn().mockResolvedValue(undefined),
            getState: vi.fn().mockReturnValue('RECORDING'),
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = stubService;

        // Reset stores
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });

        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('transition() must not set or must revert this.state when canTransitionToRecording() fails', async () => {
        expect(controller.getState()).toBe('IDLE');
        
        // canTransitionToRecording is false because isEngineReady and isEmissionsSafe are false.
        const transitionFn = (controller as unknown as { transition: (s: string) => Promise<void> }).transition.bind(controller);
        await transitionFn('RECORDING');

        // Since the transition failed the guard, the state should not be RECORDING
        expect(controller.getState()).not.toBe('RECORDING');
    });

    it('startRecording must NOT set isEmissionsSafe before engine is confirmed recording', async () => {
        const stubService = (controller as unknown as { service: unknown }).service;
        vi.spyOn(stubService as { startTranscription: (...args: unknown[]) => Promise<void> }, 'startTranscription').mockRejectedValue(new Error('MIC_PERMISSION_DENIED'));

        try {
            const policy = {
                allowNative: true,
                allowCloud: false,
                allowPrivate: false,
                preferredMode: 'native',
                allowFallback: false,
                executionIntent: 'prod-basic',
            };
            await controller.startRecording(policy as unknown as Parameters<typeof controller.startRecording>[0]);
        } catch (e) {
            // expected to throw
        }

        const isEmissionsSafe = (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe;
        expect(isEmissionsSafe).toBe(false);
    });

    it('failed engine start must leave store with isListening=false, sttStatus.type=error', async () => {
        const stubService = (controller as unknown as { service: unknown }).service;
        vi.spyOn(stubService as { startTranscription: (...args: unknown[]) => Promise<void> }, 'startTranscription').mockRejectedValue(new Error('MIC_PERMISSION_DENIED'));

        try {
            const policy = {
                allowNative: true,
                allowCloud: false,
                allowPrivate: false,
                preferredMode: 'native',
                allowFallback: false,
                executionIntent: 'prod-basic',
            };
            await controller.startRecording(policy as unknown as Parameters<typeof controller.startRecording>[0]);
        } catch (e) {
            // expected to throw
        }

        // Wait for failed visible holds and transitions
        await vi.advanceTimersByTimeAsync(10000);

        const store = useSessionStore.getState();
        expect(store.isListening).toBe(false);
        expect(store.sttStatus.type).toBe('error');
    });
});
