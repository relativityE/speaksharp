// @vitest-environment jsdom
/**
 * AHT-04 (#1593 case 4, live run 39165065684) — LEAVE DURING THE FIRST DOWNLOAD, COME BACK, AND RECORD.
 *
 * The person presses the cold `Download & start recording` control, gets tired of waiting while the model downloads,
 * leaves the session page, and later comes back. The page must offer an enabled Start, and pressing it must record and
 * save a take. The live case only checks that the returned control settles; this drives the whole journey through the
 * REAL page hook (`useSessionLifecycle`, its unmount retirement and its Start handler), the REAL controller and the REAL
 * TranscriptionService, with only the engine faked at the registry seam (the harness of unmountEngineRetirement1476).
 *
 * The download is held open (or never lands) for the whole first visit, so the leave always happens mid-download.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render } from '@testing-library/react';
import type { Result } from '../transcription/modes/types';

type Store = typeof import('@/stores/useSessionStore').useSessionStore;
let useSessionStore: Store;
type IntentApi = typeof import('../recordingIntent');
let intentApi: IntentApi;

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/transcription/runtimeCandidateTakeGate', () => ({
    evaluateRuntimeCandidateTakeGate: () => ({ enabled: false, allowed: true }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));
// Read-only account/query boundaries for the actual lifecycle hook + MicCard probe below.
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ session: null, user: null }) }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null, isVerified: false }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(), getQueriesData: () => [] }) }));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: { can_start: true, subscription_status: 'free' } }) }));
vi.mock('@/hooks/useStreak', () => ({ useStreak: () => ({ updateStreak: vi.fn() }) }));
vi.mock('@/hooks/useUserFillerWords', () => ({ useUserFillerWords: () => ({ userFillerWords: [] }) }));
vi.mock('@/providers/useTranscriptionContext', () => ({ useTranscriptionContext: () => ({ runtimeState: useSessionStore((s) => s.runtimeState) }) }));
vi.mock('@/hooks/useSpeechRecognition', () => ({ useSpeechRecognition: () => ({
    transcript: { transcript: '', partial: '', total_words: 0, duration: 0, accuracy: 100 }, chunks: [], fillerData: {},
    isReady: false, modelLoadingProgress: null, mode: 'private', pauseMetrics: null, micLevel: 0, hasSpeechActivity: false,
}) }));
/** The account lease: held by this take; `release` is what another device waits on. */
const lease = vi.hoisted(() => ({ release: vi.fn(async () => undefined), id: null as string | null }));
vi.mock('../recordingLease', () => ({
    acquireTakeLease: vi.fn(async () => ({ action: 'start', tookOver: false })),
    confirmTakeLease: vi.fn(async () => 'held'),
    startLeaseHeartbeat: vi.fn(),
    releaseTakeLease: () => lease.release(),
    currentTakeLeaseId: () => lease.id,
}));

class ControlledEngine {
    public modelCached = false;
    public initCalls = 0;
    public startCalls = 0;
    public failStart: Error | null = null;
    public failInit: Error | null = null;
    /** False models a machine where the download never lands — preparation that cannot settle. */
    public downloadEnabled = true;
    public initGate: Promise<void> | null = null;

    /** `PrivateSTT` wraps this engine and forwards option updates to it. */
    updateOptions() { /* no-op */ }
    async checkAvailability() {
        return this.modelCached
            ? { isAvailable: true }
            : { isAvailable: false, reason: 'CACHE_MISS' as const, message: 'model not cached' };
    }
    /**
     * The first init on a cold machine DISCOVERS the miss and the download completes behind it; the
     * next init finds the model present. That two-step is the real cold sequence, and modelling it
     * inside the engine is what lets the test drive preparation through Production's own completion
     * authority instead of forcing a controller state.
     */
    async init(): Promise<Result<void, Error>> {
        this.initCalls += 1;
        if (this.initGate) await this.initGate;
        if (!this.modelCached) {
            if (this.downloadEnabled) this.modelCached = true;   // the one-time download lands
            return {
                isOk: false,
                error: Object.assign(new Error('CACHE_MISS'), { code: 'CACHE_MISS' }),
            } as unknown as Result<void, Error>;
        }
        if (this.failInit) return { isOk: false, error: this.failInit } as unknown as Result<void, Error>;
        return { isOk: true, value: undefined } as unknown as Result<void, Error>;
    }
    async start() {
        this.startCalls += 1;
        if (this.failStart) throw this.failStart;
    }
    /** True models an engine whose stop REJECTS while it may still be running. */
    public stopRejects = false;
    /** When set, the engine's stop waits on this promise (held, then released by the test). */
    public stopGate: Promise<void> | null = null;
    async stop() {
        if (this.stopGate) await this.stopGate;
        if (this.stopRejects) throw new Error('engine did not stop');
    }
    async resume() { /* no-op */ }
    async pause() { /* no-op */ }
    public terminateCalls = 0;
    /** True models an engine whose termination never completes (a wedged worker). */
    public terminateHangs = false;
    /** When set, termination waits on this promise (held, then resolved or rejected by the test). */
    public terminateGate: Promise<void> | null = null;
    async terminate() {
        this.terminateCalls += 1;
        if (this.terminateHangs) await new Promise(() => undefined);
        if (this.terminateGate) await this.terminateGate;
    }
    async getTranscript() { return ''; }
    getLastHeartbeatTimestamp() { return Date.now(); }
    getEngineType() { return 'transformers-js'; }
}

const settle = async (turns = 12) => {
    for (let i = 0; i < turns; i += 1) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
};


describe('AHT-04 — leaving a cold Start mid-download, then returning, still records and saves', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        controller = (await import('../SpeechRuntimeController')).speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        priv.recordingStartedUnresolved = false;
        priv.pendingAttributionRetry = null;
        priv.pendingFullSaveRetry = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        document.documentElement.removeAttribute('data-model-status');
    });
    afterEach(() => { vi.clearAllMocks(); lease.release.mockImplementation(async () => undefined); lease.id = null; });

    /** The session page's mic card, wired as SessionPage wires it: the hook's Start handler, model status and gates. */
    const mountSessionPage = async () => {
        const { useSessionLifecycle } = await import('@/hooks/useSessionLifecycle');
        const { MicCard } = await import('@/components/session/MicCard');
        const Page = () => {
            const lifecycle = useSessionLifecycle();
            const starting = useSessionStore((st) => st.startupWaitStartedAt !== null && !st.captureLive);
            return React.createElement(MicCard, {
                onStart: () => { void lifecycle.handleStartStop(); }, starting,
                privateModelStatus: lifecycle.privateModelStatus, disabled: lifecycle.isButtonDisabled,
            });
        };
        // A visit warms the page shell, as the page's own warm-up effect does for a signed-in person.
        await controller.warmUp('private');
        const view = render(React.createElement(Page));
        await act(async () => { await settle(30); });
        return view;
    };
    const primary = (view: ReturnType<typeof render>) =>
        view.container.querySelector('button[data-testid^="mic-"]') as HTMLButtonElement;
    const press = async (view: ReturnType<typeof render>) => {
        await act(async () => { primary(view).click(); await settle(60); });
    };

    it.each([
        { name: 'download still in flight when the person returns', heldDownload: true, landsWhileAway: false },
        { name: 'download lands after the person left', heldDownload: true, landsWhileAway: true },
        { name: 'download never lands on the first visit', heldDownload: false, landsWhileAway: false },
    ])('$name', async ({ heldDownload, landsWhileAway }) => {
        // First visit: cold model, the one-click download-and-record control.
        const first = await mountSessionPage();
        expect(primary(first).dataset.testid).toBe('mic-download');
        expect(primary(first).disabled).toBe(false);

        let finishDownload: () => void = () => undefined;
        if (heldDownload) engine.initGate = new Promise<void>((resolve) => { finishDownload = resolve; });
        else engine.downloadEnabled = false;
        await press(first);
        expect(primary(first).getAttribute('aria-label'), 'precondition: the Start is waiting on the download').toBe('Starting…');
        expect(engine.startCalls).toBe(0);

        // The person leaves mid-download (the page unmounts), and stays away a while.
        await act(async () => { first.unmount(); await settle(30); });
        if (landsWhileAway) { finishDownload(); await act(async () => { await settle(30); }); }
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2_100)); });
        expect(engine.startCalls, 'the abandoned Start never recorded').toBe(0);
        expect(lease.release, 'the abandoned Start released the account lease').toHaveBeenCalledTimes(1);

        // They come back: an enabled Start, not a stale `Starting…`, a greyed-out control or a dead download.
        const back = await mountSessionPage();
        const control = primary(back);
        expect(control.disabled, `returned control: ${control.dataset.testid} "${control.getAttribute('aria-label')}"`).toBe(false);
        expect(['mic-start', 'mic-download']).toContain(control.dataset.testid);
        expect(control.getAttribute('aria-label')).not.toBe('Starting…');

        // Pressing it records…
        engine.downloadEnabled = true;
        engine.initGate = null;
        finishDownload();
        await press(back);
        expect(controller.getState()).toBe('RECORDING');
        expect(engine.startCalls).toBe(1);

        // …and the take saves.
        const storage = await import('../../lib/storage');
        await act(async () => { await controller.stopRecording(); await settle(60); });
        expect(vi.mocked(storage.saveSession)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(storage.completeSession)).toHaveBeenCalledTimes(1);
        expect(controller.getState()).toBe('READY');
        back.unmount();
    }, 30_000);
});
