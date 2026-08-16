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
    wireProgressEvaluationOnSave: vi.fn().mockResolvedValue(undefined),
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
    reset: (reason: string) => Promise<void>;
};

describe('#1258 idle reclamation — a READY Private engine is never reclaimed/reloaded', () => {
    let controller: SpeechRuntimeController;
    let priv: Priv;
    let resetSpy: MockInstance<(reason: string) => Promise<void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        setPageVisibility('visible'); // default: the session page is foreground
        controller = SpeechRuntimeController.getInstance();
        priv = controller as unknown as Priv;
        (controller as unknown as { initialized: boolean }).initialized = true;
        // reset() is what tears the engine down and triggers the model re-download/reload — stub it so we can
        // assert whether idle reclamation invoked it, without running the real teardown.
        resetSpy = vi.spyOn(priv, 'reset').mockResolvedValue(undefined);
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

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).not.toHaveBeenCalledWith('idle_reclamation');
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

    it('BACKGROUND: reclaims a ready Private engine after the idle window (frees resident memory)', async () => {
        priv.state = 'READY';
        priv.isEngineReady = true;
        priv.service = { getMode: () => 'private' };
        useSessionStore.setState({ sttMode: 'private' });
        setPageVisibility('hidden'); // the page is backgrounded — not in front of a waiting user

        priv.startIdleTimer();
        await vi.advanceTimersByTimeAsync(IDLE_RECLAMATION_MS + 1000);

        expect(resetSpy).toHaveBeenCalledWith('idle_reclamation');
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
        useSessionStore.setState({ sttMode: 'native' });

        priv.startIdleTimer();
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
