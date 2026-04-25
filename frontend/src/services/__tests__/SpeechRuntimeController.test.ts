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
        expect(controller.getState()).toBe('FAILED_VISIBLE');
        expect(useSessionStore.getState().runtimeState).toBe('FAILED_VISIBLE');

        // 3. Evidence: FAILED_VISIBLE -> TERMINATED (after hold duration)
        await vi.advanceTimersByTime(5000);
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
        await vi.advanceTimersByTime(4000);
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
});
