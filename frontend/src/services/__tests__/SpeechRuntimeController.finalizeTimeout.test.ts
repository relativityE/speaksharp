// @vitest-environment jsdom
/**
 * #1089 hung-finalization recovery.
 *
 * Finalization now disables the record control for its entire duration — which is correct, because a
 * click during finalization used to create a stray recording. But `stopTranscription()` has no internal
 * ceiling and the watchdog is stopped just before it, so a decode that never returns would strand the
 * user with a permanently disabled control and no escape but a page reload. Raising the recording cap
 * from 300s to 600s roughly doubled that exposure.
 *
 * The contract asserted here: finalization is BOUNDED, and expiry lands in the existing recovery
 * architecture rather than hanging — FAILED state, finalizing latch cleared (so the control is usable
 * again), and an honest error message that does not claim the purged transcript was kept (work point 2, D1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechRuntimeController, FinalizationTimeoutError } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { PRIV_STT } from '../transcription/sttConstants';
import { ITranscriptionService } from '../../hooks/useSpeechRecognition/useTranscriptionService';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));

describe('#1089 bounded finalization', () => {
    let controller: SpeechRuntimeController;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        controller = SpeechRuntimeController.getInstance();

        (controller as unknown as { state: string }).state = 'RECORDING';
        (controller as unknown as { initialized: boolean }).initialized = true;
        (controller as unknown as { isEngineReady: boolean }).isEngineReady = true;
        (controller as unknown as { isEmissionsSafe: boolean }).isEmissionsSafe = true;
        (controller as unknown as { sessionId: string | null }).sessionId = 'test-sess';

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('RECORDING');
        // A real recording in progress: there IS captured speech to protect.
        useSessionStore.getState().updateTranscript('the transcript captured before the hang', '');

        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('bounds a hung decode and recovers instead of leaving Finalizing… latched forever', async () => {
        // A decode that never resolves — the hang this timeout exists for.
        const hungService = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 300_000),
            stopTranscription: vi.fn(() => new Promise(() => { /* never settles */ })),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = hungService;

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);

        // Let the synchronous stop entry run, then confirm we are genuinely latched in finalization.
        await vi.advanceTimersByTimeAsync(0);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);

        // Just BEFORE the ceiling: still finalizing. A slow-but-working device must not be cut off.
        await vi.advanceTimersByTimeAsync(PRIV_STT.FINALIZE_HARD_TIMEOUT_MS - 1000);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);

        // Cross the ceiling.
        await vi.advanceTimersByTimeAsync(2000);
        const outcome = await stopPromise;

        expect(outcome).toBeInstanceOf(FinalizationTimeoutError);

        const state = useSessionStore.getState();
        // The control is usable again — this is the whole point of bounding it.
        expect(state.isTranscriptFinalizing).toBe(false);
        // Honest failure, not a silent reset and not a fake success.
        expect(state.sttStatus.type).toBe('error');
        expect(state.sttStatus.message).toContain('could not finish processing');
        // Work point 2, D1: the copy must say what was actually kept. The FAILED path purges the transcript
        // working memory (#1306), and the recovery draft is content-free, so no transcript text survives in
        // this browser. The copy used to claim "What we transcribed so far was kept in this browser".
        expect(state.transcript.transcript).toBe('');
        expect(state.sttStatus.detail).not.toMatch(/kept in this browser/i);
        expect(state.sttStatus.detail).toBe('The transcript from this recording was not saved. You can record again.');
        expect(state.sessionSaved).toBe(false);
    });

    /**
     * Work point 2, D5: a stop failure that is NOT a timeout (e.g. the final decode throws) used to show "Session was
     * not saved yet. A local recovery draft was kept in this browser after a save issue." whenever transcript text
     * existed. No save was attempted and none will follow: there is no finalized draft and no Retry Save, the
     * recording is unlocked, and the transcript is purged. The copy must say what is true.
     */
    const failingService = (error: Error) => ({
        getMode: vi.fn().mockReturnValue('private'),
        getStartTime: vi.fn().mockReturnValue(Date.now() - 60_000),
        stopTranscription: vi.fn().mockRejectedValue(error),
        destroy: vi.fn().mockResolvedValue(undefined),
        isServiceDestroyed: () => false,
        getState: vi.fn().mockReturnValue('RECORDING'),
        subscribe: vi.fn(() => vi.fn()),
        fsm: { is: vi.fn().mockReturnValue(false) },
    } as unknown as ITranscriptionService);

    it('D5: a decode failure with no pending save does not claim a save issue or a pending save', async () => {
        (controller as unknown as { service: unknown }).service = failingService(new Error('final decode failed'));
        const outcome = await controller.stopRecording().catch((e: unknown) => e);
        expect(outcome).toBeInstanceOf(Error);
        const state = useSessionStore.getState();
        expect(state.transcript.transcript).toBe('');
        expect(state.sttStatus.message).not.toMatch(/not saved yet/i);
        expect(state.sttStatus.detail ?? '').not.toMatch(/save issue/i);
        expect(state.sttStatus).toMatchObject({
            type: 'error',
            message: 'We could not finish processing this recording.',
            detail: 'The transcript from this recording was not saved. You can record again.',
        });
    });

    it('D5: when a recoverable save really is pending, the save-issue copy stays', async () => {
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = { sessionId: 'test-sess' };
        (controller as unknown as { service: unknown }).service = failingService(new Error('stop failed after save issue'));
        await controller.stopRecording().catch(() => undefined);
        expect(useSessionStore.getState().sttStatus).toMatchObject({
            type: 'warning',
            message: 'Session was not saved yet.',
            detail: 'A local recovery draft was kept in this browser after a save issue.',
        });
        (controller as unknown as { pendingFullSaveRetry: unknown }).pendingFullSaveRetry = null;
    });

    it('does NOT time out a decode that completes within the ceiling', async () => {
        const slowButWorking = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 300_000),
            stopTranscription: vi.fn(
                () => new Promise((resolve) => {
                    // ~77s is the measured worst legitimate case (600s cap at RTF ~0.128).
                    setTimeout(() => resolve({ success: true, transcript: 'ok', stats: { total_words: 2 } }), 77_000);
                }),
            ),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = slowButWorking;

        const stopPromise = controller.stopRecording().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(PRIV_STT.FINALIZE_HARD_TIMEOUT_MS);
        const outcome = await stopPromise;

        expect(outcome).not.toBeInstanceOf(FinalizationTimeoutError);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false);
    });

    it('#1089: a same-turn double stop yields ONE stop/finalize/save and zero restart', async () => {
        let releaseStop!: (v: unknown) => void;
        const stopTranscription = vi.fn(() => new Promise((resolve) => { releaseStop = resolve; }));
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 10_000),
            stopTranscription,
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = svc;

        // Two invocations in the SAME turn (a user double-click). enqueue serialises them; the finalize is
        // held pending so both are in flight before either resolves.
        const p1 = controller.stopRecording().catch((e: unknown) => e);
        const p2 = controller.stopRecording().catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);

        // Exactly one stop/finalize is underway; the control is latched finalizing (not Ready yet).
        expect(stopTranscription).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(true);

        // Complete the single finalize.
        releaseStop({ success: true, transcript: 'the finished take', stats: { total_words: 3 } });
        const [, r2] = await Promise.all([p1, p2]);
        await vi.advanceTimersByTimeAsync(0);

        expect(stopTranscription).toHaveBeenCalledTimes(1);      // one stop/finalize despite the double action
        expect(r2).toBeNull();                                   // the 2nd invocation was a no-op — no second session/identity
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false); // Ready ONLY after completion
        expect(useSessionStore.getState().runtimeState).not.toBe('RECORDING'); // zero restart
        expect(useSessionStore.getState().isListening).toBe(false);
    });

    // #1089: freezeTranscriptLifecycleAtStop latches finalization TRUE before the STOPPING transition. If
    // that transition is rejected, the latch must be cleared (control re-enabled) and the frozen snapshot
    // dropped — never left hung — rather than stranding the user behind a disabled record control.
    it('clears the finalizing latch when the STOPPING transition is rejected (recovery, not a lockout)', async () => {
        const svc = {
            getMode: vi.fn().mockReturnValue('private'),
            getStartTime: vi.fn().mockReturnValue(Date.now() - 10_000),
            stopTranscription: vi.fn().mockResolvedValue({ success: true, transcript: 'x', stats: {} }),
            destroy: vi.fn().mockResolvedValue(undefined),
            isServiceDestroyed: () => false,
            getState: vi.fn().mockReturnValue('RECORDING'),
            subscribe: vi.fn(() => vi.fn()),
            fsm: { is: vi.fn().mockReturnValue(false) },
        } as unknown as ITranscriptionService;
        (controller as unknown as { service: unknown }).service = svc;

        // Reject the STOPPING transition AFTER finalization has latched true.
        const rejection = new Error('STOPPING transition rejected');
        (controller as unknown as { transition: (t: string) => Promise<void> }).transition =
            vi.fn(async (target: string) => { if (target === 'STOPPING') throw rejection; });

        const outcome = await controller.stopRecording().catch((e: unknown) => e);

        expect(outcome).toBe(rejection);                                       // rejection propagated, not swallowed
        expect(useSessionStore.getState().isTranscriptFinalizing).toBe(false); // latch cleared → control usable
        expect(useSessionStore.getState().frozenTranscriptAtStop).toBeNull();  // frozen snapshot dropped
        expect(svc.stopTranscription).not.toHaveBeenCalled();                  // never reached finalize/save
    });
});
