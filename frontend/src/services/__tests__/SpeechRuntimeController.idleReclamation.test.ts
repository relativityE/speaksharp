// @vitest-environment jsdom
// #1258 regression: the deployed active-trial canary hung because a READY Private engine was being reclaimed
// by the 5-minute idle timer and then forced to re-download/re-init, so `mic-start` never stabilized to
// enabled. Root cause (from the failing run's Playwright trace): the idle-reclamation preserve-guard keyed off
// the nullable store `sttMode`, which is `null` in the Private-only session flow while the running engine is a
// ready Private engine — so the guard failed open and reclaimed it (reclaim → reload loop). The fix preserves
// based on the ACTUAL running engine (service mode + engine-ready). These tests reproduce the idle-reclaim
// tick and assert a ready Private engine is preserved (no reset → no reload), while non-private idle engines
// are still reclaimed.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({ success: true }),
    updateSession: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
        functions: { invoke: vi.fn().mockResolvedValue({ data: { attributed: true }, error: null }) },
    })),
}));
vi.mock('../progress/recordProgress', () => ({
    // #1354: the seam now returns a discriminated outcome and the controller gates the recorder on it.
    // `recorded` keeps these existing tests on the UNLOCKED path, which is what they were written for.
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue({ kind: 'recorded' }),
    progressOutcomeAllowsNextRecording: (o: { kind: string }) =>
        o.kind === 'recorded' || o.kind === 'not_applicable',
}));

const IDLE_RECLAMATION_MS = 5 * 60 * 1000;

function setPageVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

type Priv = {
    state: string;
    isEngineReady: boolean;
    service: unknown;
    startIdleTimer: () => void;
    reset: (reason: string) => void;
    pendingFullSaveRetry: unknown;
    pendingAttributionRetry: unknown;
    recordingStartedUnresolved: boolean;
};

describe('#1258 idle reclamation — a READY Private engine is never reclaimed/reloaded', () => {
    let controller: SpeechRuntimeController;
    let priv: Priv;
    let resetSpy: MockInstance<(reason: string) => void>;

    beforeEach(() => {
        vi.useFakeTimers();
        setPageVisibility('visible'); // default: the session page is foreground
        controller = SpeechRuntimeController.getInstance();
        priv = controller as unknown as Priv;
        (controller as unknown as { initialized: boolean }).initialized = true;
        // reset() is what tears the engine down and triggers the model re-download/reload — stub it so we can
        // assert whether idle reclamation invoked it, without running the real teardown.
        priv.pendingFullSaveRetry = null;
        priv.pendingAttributionRetry = null;
        priv.recordingStartedUnresolved = false;
        resetSpy = vi.spyOn(priv, 'reset').mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        setPageVisibility('visible');
    });

    it('FOREGROUND: preserves a ready Private engine even when the store sttMode is null (the canary flow)', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        // The exact failing condition: Private-only session leaves the store mode unset (null), while the
        // running engine is a ready Private engine, and the page is foreground.
        useSessionStore.setState({ sttMode: null });
        const genBefore = controller.getIdleReclamationGeneration();

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).not.toHaveBeenCalledWith('idle_reclamation');
        // A foreground preserve is NOT a reclamation — the token must not advance (so no spurious return reload).
        expect(controller.getIdleReclamationGeneration()).toBe(genBefore);
    });

    it('FOREGROUND: preserves a ready Private engine when sttMode is explicitly private', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: 'private' });

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).not.toHaveBeenCalledWith('idle_reclamation');
    });

    it('BACKGROUND: reclaims a ready Private engine after the idle window and BUMPS the reclamation token', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: 'private' });
        setPageVisibility('hidden'); // the page is backgrounded — not in front of a waiting user
        const genBefore = controller.getIdleReclamationGeneration();

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
        // The token that authorizes a foreground-return reload advances ONLY on a real reclamation.
        expect(controller.getIdleReclamationGeneration()).toBe(genBefore + 1);
    });

    it('does NOT advance the token when the reset itself FAILS (no reload for a reclamation that never completed)', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: 'private' });
        setPageVisibility('hidden');
        resetSpy.mockImplementationOnce(() => { throw new Error('reset boom'); }); // reset is synchronous (returns void)
        const genBefore = controller.getIdleReclamationGeneration();

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
        // A thrown reset must mint NO reload token.
        expect(controller.getIdleReclamationGeneration()).toBe(genBefore);
    });

    it('NO reclaim→reload loop: a preserved foreground engine is reclaimed ONLY once it is later backgrounded', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: 'private' });

        // First idle window, foreground → preserved (no reset, i.e. no reload loop).
        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(resetSpy).not.toHaveBeenCalledWith('idle_reclamation');

        // The guard re-arms itself; once the page is backgrounded, the next window reclaims.
        setPageVisibility('hidden');
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
    });

    it('still reclaims a non-Private idle engine (reclamation is not disabled wholesale)', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'native' };
        useSessionStore.setState({ sttMode: 'private' });

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
    });

    /*
     * AN UNSAVED TAKE OUTRANKS RECLAIMED MEMORY.
     *
     * `reset('idle_reclamation')` goes through `applyHardResetState`, whose own comment scopes that clearing
     * to "navigation/logout/account change/manual": it nulls `pendingFullSaveRetry` and
     * `pendingAttributionRetry` and resets the transcript lifecycle. Reached on a TIMER, that discards the
     * only handle Retry Save has, on a page the user merely left in the background.
     *
     * Nothing recovers it in place. The durable `sessionRecoveryDraft` survives, but SessionPage re-arms the
     * controller from it ONCE per mount (`useUnresolvedRecovery`), so returning to the same tab never
     * re-arms — and that draft is content-free by design ("no transcript was saved, and only partial
     * measurements were captured"). So the take's text becomes unrecoverable, silently, five minutes after
     * the user switched tabs.
     *
     * Freeing memory is worth doing; it is not worth a take the user has not saved. While a recovery is
     * pending the timer re-arms instead, so the reclaim still happens once the retry resolves.
     */
    it('CASUALTY: a pending full-save retry is NEVER reclaimed away on a backgrounded page', async () => {
        priv.state = 'IDLE';
        priv.isEngineReady = false;
        priv.service = { getMode: () => 'private' };
        setPageVisibility('hidden');
        priv.pendingFullSaveRetry = { sessionId: 'sess-unsaved', initialSave: false };

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy, 'the retry handle must not be cleared by a timer').not.toHaveBeenCalled();
        expect(controller.hasPendingAttribution(), 'Retry Save is still available').toBe(true);

        // ...and once the retry resolves, the engine IS reclaimed: the guard defers, never disables.
        priv.pendingFullSaveRetry = null;
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
    });

    it('CASUALTY: a pending ATTRIBUTION retry is preserved on the same rule', async () => {
        priv.state = 'IDLE';
        priv.isEngineReady = false;
        priv.service = { getMode: () => 'private' };
        setPageVisibility('hidden');
        priv.pendingAttributionRetry = { sessionId: 'sess-attr' };

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).not.toHaveBeenCalled();
        expect(controller.hasPendingAttribution()).toBe(true);
    });

    /*
     * THE THIRD STATE THE HARD RESET DESTROYS, AND THE ONE A RETRY-ONLY GUARD MISSES.
     *
     * `applyHardResetState` also calls `markRecordingResolved()`, clearing `recordingStartedUnresolved` and
     * `pendingInitialSaveContext`: the post-start failure window that finalization, STT, stop and heartbeat
     * failures land in. Those never reach a save, so they set NO retry handle — `hasPendingAttribution()` is
     * false precisely for the cases whose recovery window this reset closes. They also land in `IDLE`, which
     * the ready-private preserve rule does not cover even in the foreground, so five minutes is all it takes.
     */
    it('CASUALTY: a post-start failure that never reached a save is not reclaimed away (FOREGROUND too)', async () => {
        priv.state = 'IDLE';
        priv.isEngineReady = false;
        priv.service = { getMode: () => 'private' };
        setPageVisibility('visible');          // the wider case: not only the backgrounded one
        priv.recordingStartedUnresolved = true; // a recording began and never durably resolved
        priv.pendingFullSaveRetry = null;       // ...and no save was ever attempted, so no retry handle
        priv.pendingAttributionRetry = null;
        expect(controller.hasPendingAttribution(), 'the retry-only predicate cannot see this state').toBe(false);
        expect(controller.isEngineSelectionLocked(), 'the lock predicate can').toBe(true);

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy, 'the unresolved-recording window must survive the timer').not.toHaveBeenCalled();

        // Once the recording resolves, reclamation proceeds.
        priv.recordingStartedUnresolved = false;
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);
        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
    });

    it('still reclaims a Private engine that is NOT yet ready (isEngineReady false)', async () => {
        priv.state = 'READY';
        priv.isEngineReady = false;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: null });

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
    });
});
