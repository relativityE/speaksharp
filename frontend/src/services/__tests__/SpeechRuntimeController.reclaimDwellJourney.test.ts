// @vitest-environment jsdom
/**
 * THE JOURNEY B1 EXISTS FOR, END TO END, WITH THE REAL CONTROLLER.
 *
 * A user finishes a take. The save fails, so the page offers Retry Save. They switch to another tab to
 * look something up — a thing people do constantly — and come back more than five minutes later. That
 * dwell is the whole bug: the idle-reclamation timer fired while the tab was hidden, and its hard reset
 * cleared the retry handle and the unresolved marker, so the user returned to a page that had quietly
 * forgotten the take. Nothing re-armed it in place: `useUnresolvedRecovery` rehydrates once per MOUNT,
 * and the page never unmounted.
 *
 * This is deliberately NOT a unit test of the guard (that is `SpeechRuntimeController.idleReclamation`).
 * It arms the recovery the way production arms it — `rehydrateUnresolvedRecording` reading a REAL
 * finalized draft out of localStorage — then drives the REAL five-minute timer, the REAL reset path, and
 * the REAL `retryRecordingSave`, asserting what the user actually gets: the retry still works after the
 * dwell, and the engine is still reclaimed once the take is resolved.
 *
 * The browser tier cannot state this journey honestly today: it has no save-failure injection seam (the
 * only live double is `setupE2EManifest`, which has no such knob), and a real five-minute dwell needs
 * clock control that no spec in `tests/e2e` uses yet. Both would be new test infrastructure landing the
 * night before a real-world test. This tier proves the same sequence against the same code, with the same
 * timer, deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ status: 'saved', session: { id: 'sess-dwell' } }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-dwell' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: { attributed: true }, error: null }) },
    })),
}));
vi.mock('@/services/progress/recordProgress', () => ({ wireProgressEvaluationOnSave: vi.fn().mockResolvedValue(undefined) }));

import { SpeechRuntimeController } from '@/services/SpeechRuntimeController';
import { saveSessionRecoveryDraft, getRecoverableDraftForUser } from '@/services/sessionRecoveryDraft';
import { completeSession } from '@/lib/storage';
import { NEXT_ACTION_TEMPLATE_VERSION } from '@/contracts/nextActionSignal';

const IDLE_RECLAMATION_MS = 5 * 60 * 1000;
const USER = 'user-dwell';
const SESSION = 'sess-dwell';

type Priv = {
    state: string;
    isEngineReady: boolean;
    service: unknown;
    capturedUserId: string | null;
    startIdleTimer: () => void;
    // Stubbed the way `SpeechRuntimeController.retryPersistence` stubs them: the SERVER boundary only.
    // Arming, deferral, the timer, the slot bookkeeping and the lock publication all run for real.
    attestSessionEngine: (sessionId: string, evidence: unknown) => Promise<{ attributed: boolean } | null>;
    completeProgressForRecording: (...args: unknown[]) => Promise<void>;
};

const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
};

/** The draft a clean stop leaves behind: final metrics + one structured next action. No transcript text. */
const writeFinalizedDraft = () => {
    saveSessionRecoveryDraft({
        sessionId: SESSION,
        userId: USER,
        recoveryState: 'finalized_pending_save',
        durationSeconds: 92,
        mode: 'private',
        metrics: { totalWords: 240, clarityScore: 88, wpm: 156, fillerCounts: { um: 3 }, pauseMetrics: {} },
        nextActionSignal: {
            reasonCode: 'HIGH_FILLER_RATE',
            actionCode: 'REDUCE_FILLERS',
            metric: 'filler_rate',
            value: 1.25,
            comparator: 'above_target',
            templateVersion: NEXT_ACTION_TEMPLATE_VERSION,
        },
        subject: null,
    });
    // Guard the fixture itself: a draft the sanitizer downgraded would make this whole journey vacuous,
    // because `rehydrateUnresolvedRecording` only re-arms a FINALIZED draft.
    expect(getRecoverableDraftForUser(USER)?.recoveryState, 'fixture must persist as a finalized draft').toBe('finalized_pending_save');
};

describe('the tab-switch dwell journey: an unsaved take must survive being left alone', () => {
    let controller: SpeechRuntimeController;
    let priv: Priv;
    let fakeService: { getMode: () => string; destroy: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        window.localStorage.clear();
        setVisibility('visible');

        controller = SpeechRuntimeController.getInstance();
        priv = controller as unknown as Priv;
        (controller as unknown as { initialized: boolean }).initialized = true;
        vi.spyOn(controller, 'warmUp').mockResolvedValue(undefined);

        // A ready Private engine, as the page has after a take.
        fakeService = { getMode: () => 'private', destroy: vi.fn().mockResolvedValue(undefined) };
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = fakeService as never;
        priv.capturedUserId = USER;

        // The server: attestation terminal-attributed, the Progress write accepted. Everything the
        // journey is about — the retry slot surviving a dwell — is real.
        priv.attestSessionEngine = vi.fn().mockResolvedValue({ attributed: true });
        priv.completeProgressForRecording = vi.fn().mockResolvedValue(undefined);
        vi.mocked(completeSession).mockResolvedValue({ success: true } as never);
    });

    afterEach(() => {
        controller.reset('manual');
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        window.localStorage.clear();
        setVisibility('visible');
    });

    it('a failed save still offers Retry Save after a >5 minute tab switch, and the retry completes the take', async () => {
        writeFinalizedDraft();

        // The state the user is in: stop finished, the save did not, Retry Save is on screen.
        expect(controller.rehydrateUnresolvedRecording(USER), 'production arms recovery from the finalized draft').toBe(true);
        expect(controller.pendingResolutionKind()).toBe('full_save');
        expect(controller.isEngineSelectionLocked()).toBe(true);

        // They switch tabs and stay away past the reclamation window.
        setVisibility('hidden');
        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS * 2 + 1000);

        // THE ASSERTION THAT MATTERS: coming back, the take is still there to retry.
        expect(controller.pendingResolutionKind(), 'Retry Save must still be armed after the dwell').toBe('full_save');
        expect(controller.isEngineSelectionLocked(), 'the take is still unresolved, so the engine stays locked').toBe(true);
        expect(fakeService.destroy, 'the engine must not have been torn down under an unsaved take').not.toHaveBeenCalled();
        setVisibility('visible');

        // And Retry Save actually works — the row completes and the recording resolves.
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(completeSession).toHaveBeenCalledWith(SESSION, expect.objectContaining({ status: 'completed', duration: 92 }));
        expect(controller.pendingResolutionKind(), 'a settled retry leaves nothing pending').toBeNull();
    });

    it('once the take is resolved, the deferral stops deferring: the engine IS reclaimed', async () => {
        writeFinalizedDraft();
        expect(controller.rehydrateUnresolvedRecording(USER)).toBe(true);

        setVisibility('hidden');
        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(fakeService.destroy).not.toHaveBeenCalled();

        // Resolve it (the user retried successfully), then let the next window elapse.
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(controller.isEngineSelectionLocked()).toBe(false);

        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(fakeService.destroy, 'reclamation is deferred, never disabled').toHaveBeenCalledTimes(1);
        expect(controller.getState()).toBe('IDLE');
    });

    it('a failed retry stays retryable across a SECOND dwell — the user gets another chance, not silence', async () => {
        writeFinalizedDraft();
        expect(controller.rehydrateUnresolvedRecording(USER)).toBe(true);

        // First retry fails (the server is still unavailable).
        vi.mocked(completeSession).mockResolvedValue({ success: false } as never);
        await expect(controller.retryRecordingSave()).resolves.toBe(false);
        expect(controller.pendingResolutionKind(), 'a failed retry must not consume the recovery').toBe('full_save');

        // They give up for now and switch tabs again.
        setVisibility('hidden');
        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS * 3 + 1000);
        setVisibility('visible');

        expect(controller.pendingResolutionKind(), 'still retryable after the second dwell').toBe('full_save');
        vi.mocked(completeSession).mockResolvedValue({ success: true } as never);  // the server recovers
        await expect(controller.retryRecordingSave()).resolves.toBe(true);
        expect(controller.pendingResolutionKind()).toBeNull();
    });
});
