// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';

// Mock Dependencies
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

describe('SpeechRuntimeController FSM Expansion (Steps 1-4)', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();
        // Reset singleton private state
        (controller as unknown as { state: string }).state = 'IDLE';
        (controller as unknown as { initialized: boolean }).initialized = true;
        const stubService = {
            updatePolicy: vi.fn().mockResolvedValue(undefined),
            warmUp: vi.fn().mockResolvedValue(undefined),
            getMode: vi.fn().mockReturnValue('native'),
            getStrategy: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
            fsm: { is: vi.fn().mockReturnValue(false) },
            subscribe: vi.fn(() => vi.fn()),
            destroy: async () => {
                // ✅ Absolute clear to prevent heartbeat recursion
                vi.clearAllTimers();
                // ✅ Directly satisfy the lock invariant — no re-entrant controller call
                const lock = (controller as unknown as { lock: { updateState: (s: string) => void; release: () => void } }).lock;
                lock.updateState('TERMINATED');
                lock.release();
            },
            isServiceDestroyed: () => false,
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = stubService;

        // Reset stores
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        useSessionStore.getState().setSTTStatus({ type: 'idle', message: 'Ready' });

        vi.clearAllMocks();
    });

    afterEach(() => {
        // Definitively kill all pending timers including the heartbeat
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should transition FAILED -> FAILED_VISIBLE -> TERMINATED sequentially', async () => {
        // 1. Initial State
        expect(controller.getState()).toBe('IDLE');

        // 2. Trigger Failure
        // Simulate a transition to FAILED (e.g. from an error)
        (controller as unknown as { transition: (s: string) => void }).transition('FAILED');

        // In the new logic, FAILED immediately transitions to FAILED_VISIBLE
        // Wait for the enqueue queue to flush
        await new Promise(resolve => setTimeout(resolve, 0));
        
        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().runtimeState).toBe('FAILED_VISIBLE');

        // 3. Evidence: FAILED_VISIBLE -> TERMINATED (after hold duration)
        await vi.advanceTimersByTimeAsync(5000);
        expect(controller.getState()).toBe('TERMINATED');
        expect(useSessionStore.getState().runtimeState).toBe('TERMINATED');
    });

    it('should NOT release the lock during FAILED or FAILED_VISIBLE', async () => {
        const localStorageSpy = vi.spyOn(Storage.prototype, 'removeItem');
        vi.clearAllMocks();
        vi.useFakeTimers();

        // Set SSOT manifest to ensure deterministic CI timers (50ms)
        window.__SS_E2E__ = {
            isActive: true,
            engineType: 'system',
            registry: {},
            flags: {
                bypassMutex: true,
                fastTimers: true
            }
        };

        // Setup active session
        (controller as unknown as { state: string }).state = 'IDLE';
        // Use the internal lock instance to acquire
        (controller as unknown as { lock: { acquire: (s: string) => void } }).lock.acquire('INITIATING');

        (controller as unknown as { state: string }).state = 'RECORDING';
        useSessionStore.getState().setRuntimeState('RECORDING');

        // Trigger FAILED
        (controller as unknown as { transition: (s: string) => void }).transition('FAILED');

        // Verification: Lock should still be held
        expect(localStorageSpy).not.toHaveBeenCalledWith('speaksharp_active_session_lock');

        // Advance to FAILED_VISIBLE (Must be less than 50ms CI hold to stay in this state)
        await vi.advanceTimersByTime(30);
        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(localStorageSpy).not.toHaveBeenCalledWith('speaksharp_active_session_lock');

        // Advance to TERMINATED (Total duration from FAILED: 30ms + 4000ms = 4030ms > 4000ms threshold)
        await vi.advanceTimersByTimeAsync(4000);
        expect(controller.getState()).toBe('TERMINATED');

        // Verification: Lock should finally be released
        expect(localStorageSpy).toHaveBeenCalledWith('speaksharp_active_session_lock');
    });

    it('should allow isExitTransition to recognize TERMINATED as a cleanup state', () => {
        // We verify this by seeing if transition('TERMINATED') clears the engine
        const store = useSessionStore.getState();
        store.setActiveEngine('native');

        (controller as unknown as { transition: (s: string) => void }).transition('TERMINATED');

        expect(store.activeEngine).toBe(null);
    });

    it('preserves actionable mic errors while cleanup terminates the failed start', async () => {
        (controller as unknown as { handleError: (error: Error) => void }).handleError(
            new Error('NotAllowedError: microphone permission denied')
        );
        await controller.whenStable();

        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({
            type: 'error',
            message: 'Microphone access is denied. Please grant permission in your browser settings.',
        }));

        await vi.advanceTimersByTimeAsync(5000);
        expect(controller.getState()).toBe('TERMINATED');
        expect(useSessionStore.getState().sttStatus).toEqual(expect.objectContaining({
            type: 'error',
            message: 'Microphone access is denied. Please grant permission in your browser settings.',
        }));
    });

    it('preserves an allowed explicit Cloud selection during late Pro policy sync', async () => {
        const store = useSessionStore.getState();
        store.setSTTMode('cloud');

        controller.updatePolicy({
            allowNative: true,
            allowCloud: true,
            allowPrivate: true,
            preferredMode: 'private',
            allowFallback: true,
            executionIntent: 'prod-pro-default',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'cloud',
            allowFallback: false,
            executionIntent: 'prod-pro-default-cloud-preserved',
        }));
    });

    it('does not preserve Cloud when the effective policy disallows it', async () => {
        const store = useSessionStore.getState();
        store.setSTTMode('cloud');

        controller.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        }));
    });

    it('delegates policy changes once and avoids duplicate warm-up loops', async () => {
        controller.updatePolicy({
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        });
        await controller.whenStable();

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn>; warmUp: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledTimes(1);
        expect(service.warmUp).not.toHaveBeenCalled();
    });

    it('ignores stale disallowed mode callbacks from an old strategy', () => {
        const store = useSessionStore.getState();
        store.setSTTMode('native');
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: false,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-free',
        };

        (controller as unknown as { handleModeChange: (mode: string) => void }).handleModeChange('private');

        expect(useSessionStore.getState().sttMode).toBe('native');
    });

    it('applies the requested warm-up mode to the service policy before readiness checks', async () => {
        (controller as unknown as { policy: unknown }).policy = {
            allowNative: true,
            allowCloud: true,
            allowPrivate: true,
            preferredMode: 'native',
            allowFallback: false,
            executionIntent: 'prod-pro-native',
        };

        await controller.warmUp('private');

        const service = (controller as unknown as { service: { updatePolicy: ReturnType<typeof vi.fn> } }).service;
        expect(service.updatePolicy).toHaveBeenCalledWith(expect.objectContaining({
            preferredMode: 'private',
            allowPrivate: true,
            executionIntent: 'prod-pro-native',
        }));
    });

    it('replaces an earlier partial-like final when a provider sends a fuller final with punctuation changes', () => {
        const store = useSessionStore.getState();
        store.updateTranscript('you know the box was thrown', '');

        (controller as unknown as { pushTranscriptToStore: (data: { transcript: { final: string } }) => void }).pushTranscriptToStore({
            transcript: {
                final: 'You know, the box was thrown beside the parked truck.',
            },
        });

        expect(useSessionStore.getState().transcript.transcript).toBe('You know, the box was thrown beside the parked truck.');
    });

    it('promotes live partial text into final transcript without losing visible text', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { partial?: string; final?: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { partial: 'today i want to give a clear update' } });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: '',
            partial: 'Today i want to give a clear update',
        });

        push({ transcript: { final: 'today i want to give a clear update on speaksharp' } });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: 'Today, I want to give a clear update on speaksharp.',
            partial: '',
        });
        expect(useSessionStore.getState().chunks).toEqual([
            expect.objectContaining({
                transcript: 'Today, I want to give a clear update on speaksharp.',
                isFinal: true,
            }),
        ]);
    });

    it('adds punctuation between separate final transcript segments', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'today i want to give a clear update' } });
        push({ transcript: { final: 'next the coaching should turn numbers into actions' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'Today, I want to give a clear update. Next, the coaching should turn numbers into actions.'
        );
    });

    it('adds conservative commas and first-person capitalization without rewriting words', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'for example i should pause before the takeaway' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'For example, I should pause before the takeaway.'
        );
    });

    it('keeps filler words visible while formatting a competitor-grade spoken sample', () => {
        const push = (controller as unknown as {
            pushTranscriptToStore: (data: { transcript: { final: string } }) => void
        }).pushTranscriptToStore.bind(controller);

        push({ transcript: { final: 'today i want to give a clear update um the main point is simple' } });
        push({ transcript: { final: 'for example like if i pause before the takeaway the message lands' } });
        push({ transcript: { final: 'finally i want the transcript to feel polished' } });

        expect(useSessionStore.getState().transcript.transcript).toBe(
            'Today, I want to give a clear update um the main point is simple. For example, like if I pause before the takeaway the message lands. Finally, I want the transcript to feel polished.'
        );
        expect(useSessionStore.getState().transcript.transcript).toContain('um');
        expect(useSessionStore.getState().transcript.transcript).toContain('like');
    });

    it('clears stale partial text when a duplicate final arrives', () => {
        const store = useSessionStore.getState();
        store.updateTranscript('today i want to give a clear update', 'today i want');
        store.setChunks([{ transcript: 'today i want to give a clear update', timestamp: 123, isFinal: true }]);

        (controller as unknown as { pushTranscriptToStore: (data: { transcript: { final: string } }) => void }).pushTranscriptToStore({
            transcript: {
                final: 'today i want to give a clear update',
            },
        });

        expect(useSessionStore.getState().transcript).toEqual({
            transcript: 'Today i want to give a clear update',
            partial: '',
        });
    });

    it('projects transcript updates to the visible store even when subscriber callbacks are not ready', () => {
        const callback = vi.fn();
        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = false;
        (controller as unknown as { subscriberCallbacks: { onTranscriptUpdate?: typeof callback } }).subscriberCallbacks = {
            onTranscriptUpdate: callback,
        };

        (controller as unknown as { handleTranscriptUpdate: (data: { transcript: { partial: string } }) => void }).handleTranscriptUpdate({
            transcript: { partial: 'the birch canoe slid' },
        });

        expect(useSessionStore.getState().transcript.partial).toBe('The birch canoe slid');
        expect(callback).not.toHaveBeenCalled();

        (controller as unknown as { isSubscriberReady: boolean }).isSubscriberReady = true;
        (controller as unknown as { flushQueues: () => void }).flushQueues();

        expect(useSessionStore.getState().transcript.partial).toBe('The birch canoe slid');
        expect(useSessionStore.getState().chunks).toHaveLength(0);
        expect(callback).toHaveBeenCalledWith({
            transcript: { partial: 'the birch canoe slid' },
        });
    });
});
