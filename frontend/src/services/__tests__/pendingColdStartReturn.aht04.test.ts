// @vitest-environment jsdom
/**
 * AHT-04 (#1593 case 4, live run 39165065684) — LEAVE DURING THE FIRST DOWNLOAD, COME BACK, AND RECORD.
 *
 * The person presses the cold `Download & start recording` control, gets tired of waiting while the model downloads,
 * leaves the session page, and later comes back. The page must offer an enabled Start, and pressing it must start
 * recording, and stopping must save the take.
 *
 * What runs for real: the session page's hook (`useSessionLifecycle`: its own mode sync and warm-up for a signed-in,
 * verified account, its unmount retirement, its Start/Stop handler), MicCard wired as SessionPage wires it, the
 * controller, TranscriptionService and `lib/storage`'s save and completion. What is faked: the engine at the registry
 * seam (the harness of unmountEngineRetirement1476), the account lease, and the Supabase client — an in-memory stand-in
 * for the two save RPCs, so the take is asserted as the row the save path actually sent, not as a mocked call. The real
 * database, the real Whisper worker and a real browser are NOT exercised here; the live AHT-04 journey on the release is
 * still the proof that the October failure is gone.
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
/**
 * An in-memory stand-in for the Supabase client: the two RPCs a take's save goes through (row creation, then the atomic
 * completion), the session read the controller uses for the owner, and inert edge functions. Rows land in `db.sessions`.
 */
const db = vi.hoisted(() => ({
    sessions: [] as Array<Record<string, unknown>>,
    rpcCalls: [] as string[],
}));
vi.mock('../../lib/supabaseClient', () => {
    const rows = () => Promise.resolve({ data: [], error: null, count: 0 });
    const chain: Record<string, unknown> = new Proxy({}, {
        get: (_t, key) => (key === 'then' ? (r: (v: unknown) => void) => rows().then(r) : () => chain),
    });
    const rpc = async (name: string, args: Record<string, unknown>) => {
        db.rpcCalls.push(name);
        if (name === 'create_session_and_update_usage') {
            const row = { ...(args.p_session_data as Record<string, unknown>), id: `sess-${db.sessions.length + 1}`,
                engine_type: args.p_engine_type, status: 'active' };
            db.sessions.push(row);
            return { data: { new_session: row }, error: null };
        }
        if (name === 'complete_session_v2') {
            const row = db.sessions.find((r) => r.id === args.p_session_id);
            if (!row) return { data: null, error: { code: 'P0002', message: 'no such session' } };
            const transcript = typeof args.p_final_transcript === 'string' && args.p_final_transcript.trim() ? args.p_final_transcript : null;
            Object.assign(row, { status: args.p_status, duration: args.p_final_duration ?? row.duration, transcript });
            return { data: { success: true, session_saved: true, final_status: args.p_status,
                transcript_outcome: transcript ? 'retained' : 'not_provided', transcript_state: transcript ? 'available' : 'not_captured',
                transcript_retained: Boolean(transcript) }, error: null };
        }
        if (name === 'heartbeat_session') return { data: { success: true }, error: null };
        // The signed-in Start's pre-flight scan for unfinished saves owed by this account: none.
        if (name === 'get_progress_obligations') return { data: [], error: null };
        return { data: null, error: null };
    };
    const client = {
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
        rpc: vi.fn(rpc),
        from: () => chain,
        functions: { invoke: vi.fn(async () => ({ data: { attributed: false }, error: null })) },
    };
    return { getSupabaseClient: vi.fn(() => client) };
});
vi.mock('@/services/transcription/runtimeCandidateTakeGate', () => ({
    evaluateRuntimeCandidateTakeGate: () => ({ enabled: false, allowed: true }),
}));
// Read-only account/query boundaries for the actual lifecycle hook + MicCard probe below.
// A signed-in, verified trial account: what lets the page's own mode sync and warm-up run, as they do in production.
const account = vi.hoisted(() => ({
    user: { id: 'test-user' },
    profile: { id: 'test-user', subscription_status: 'trial' },
}));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ session: { user: account.user }, user: account.user }) }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: account.profile, isVerified: true }) }));
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
    /** What the person said during the take (the engine's own final transcript once it has recorded). */
    public spoken = 'Today I want to walk through the plan for our quarterly review meeting.';
    async getTranscript() { return this.startCalls > 0 ? this.spoken : ''; }
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
        db.sessions.length = 0;
        db.rpcCalls.length = 0;
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
        // A fresh visit: no engine chosen yet, so the page's own mode sync picks Private and its warm-up runs.
        useSessionStore.setState({ sttMode: null });
        document.documentElement.removeAttribute('data-model-status');
    });
    afterEach(() => { vi.clearAllMocks(); lease.release.mockImplementation(async () => undefined); lease.id = null; });

    /**
     * The session page's mic card, wired as SessionPage wires it: the hook's Start/Stop handler (SessionPage's
     * `onStartStop`), its model status and its gates. Nothing is warmed by the test — the page initializes itself.
     */
    const mountSessionPage = async () => {
        const { useSessionLifecycle } = await import('@/hooks/useSessionLifecycle');
        const { MicCard } = await import('@/components/session/MicCard');
        const handler: { startStop: () => Promise<void> } = { startStop: async () => undefined };
        const Page = () => {
            const lifecycle = useSessionLifecycle();
            handler.startStop = () => lifecycle.handleStartStop();
            const starting = useSessionStore((st) => st.startupWaitStartedAt !== null && !st.captureLive);
            return React.createElement(MicCard, {
                onStart: () => { void lifecycle.handleStartStop(); }, starting,
                privateModelStatus: lifecycle.privateModelStatus, disabled: lifecycle.isButtonDisabled,
            });
        };
        const view = render(React.createElement(Page));
        await act(async () => { await settle(30); });
        return Object.assign(view, { stop: async () => { await act(async () => { await handler.startStop(); await settle(60); }); } });
    };
    type Page = Awaited<ReturnType<typeof mountSessionPage>>;
    const primary = (view: Page) =>
        view.container.querySelector('button[data-testid^="mic-"]') as HTMLButtonElement;
    const describeControl = (view: Page) => `${primary(view).dataset.testid} "${primary(view).getAttribute('aria-label')}"`;
    const press = async (view: Page) => {
        await act(async () => { primary(view).click(); await settle(60); });
    };
    const wait = async (ms: number) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };

    /** The first visit: the page initializes itself into the cold download control; the person presses it. */
    const pressColdStart = async (opts: { heldDownload: boolean }) => {
        const first = await mountSessionPage();
        expect(useSessionStore.getState().sttMode, 'the page selected Private itself').toBe('private');
        expect(primary(first).dataset.testid, 'the page warmed itself into the cold download control').toBe('mic-download');
        expect(primary(first).disabled).toBe(false);
        let finishDownload: () => void = () => undefined;
        if (opts.heldDownload) engine.initGate = new Promise<void>((resolve) => { finishDownload = resolve; });
        else engine.downloadEnabled = false;
        await press(first);
        expect(primary(first).getAttribute('aria-label'), 'precondition: the Start is waiting on the download').toBe('Starting…');
        expect(engine.startCalls).toBe(0);
        return { first, finishDownload };
    };

    /** Pressing the returned control records; the page's own Stop saves exactly one completed take for this account. */
    const recordAndSave = async (back: Page, finishDownload: () => void) => {
        engine.downloadEnabled = true;
        engine.initGate = null;
        finishDownload();
        await press(back);
        expect(controller.getState(), `after pressing ${describeControl(back)}`).toBe('RECORDING');
        expect(engine.startCalls).toBe(1);

        await back.stop();
        expect(controller.getState()).toBe('READY');
        expect(db.rpcCalls.filter((n) => n === 'create_session_and_update_usage'), 'one row created').toHaveLength(1);
        expect(db.rpcCalls.filter((n) => n === 'complete_session_v2'), 'one completion').toHaveLength(1);
        expect(db.sessions).toHaveLength(1);
        expect(db.sessions[0]).toMatchObject({ user_id: 'test-user', engine_type: 'private', status: 'completed',
            // The engine's words, as the save path's own transcript cleanup leaves them.
            transcript: expect.stringContaining('walk through the plan for our quarterly review meeting') });
        back.unmount();
    };

    it.each([
        { name: 'download still in flight when the person returns', heldDownload: true, landsWhileAway: false },
        { name: 'download lands after the person left', heldDownload: true, landsWhileAway: true },
        { name: 'download never lands on the first visit', heldDownload: false, landsWhileAway: false },
    ])('$name', async ({ heldDownload, landsWhileAway }) => {
        const { first, finishDownload } = await pressColdStart({ heldDownload });

        // The person leaves mid-download (the page unmounts), and stays away a while.
        await act(async () => { first.unmount(); await settle(30); });
        if (landsWhileAway) { finishDownload(); await act(async () => { await settle(30); }); }
        await wait(2_100);
        expect(engine.startCalls, 'the abandoned Start never recorded').toBe(0);
        expect(lease.release, 'the abandoned Start released the account lease').toHaveBeenCalledTimes(1);
        expect(db.sessions, 'the abandoned Start saved nothing').toHaveLength(0);

        // They come back: an enabled Start, not a stale `Starting…`, a greyed-out control or a dead download.
        const back = await mountSessionPage();
        expect(primary(back).disabled, `returned control: ${describeControl(back)}`).toBe(false);
        expect(['mic-start', 'mic-download']).toContain(primary(back).dataset.testid);
        expect(primary(back).getAttribute('aria-label')).not.toBe('Starting…');

        await recordAndSave(back, finishDownload);
    }, 45_000);

    /**
     * The suspected October cause (#1593 case 4, fixed by #1668): stopping the abandoned engine takes longer than the
     * unmount's 10 s bound, so the retirement returns `unconfirmed` before its TERMINATED/IDLE transitions, and the engine
     * only proves itself off later. Until it does, the returned page truthfully holds Start; once it does, the late
     * retirement must finish the runtime, release the lease and give the person a Start that records and saves. Without
     * `completeLateRetirement` the runtime stays in the retired preparation state and Start is greyed out for good.
     */
    it('engine stop outlasts the 10 s unmount bound, then completes while the person is back on the page', async () => {
        let finishTermination: () => void = () => undefined;
        engine.terminateGate = new Promise<void>((resolve) => { finishTermination = resolve; });
        const { first, finishDownload } = await pressColdStart({ heldDownload: true });

        await act(async () => { first.unmount(); await settle(30); });
        await wait(10_500);   // past the retirement's 10 s bound, with the engine still not off
        expect(engine.terminateCalls, 'the retirement asked the engine to terminate').toBeGreaterThan(0);
        expect(lease.release, 'unconfirmed: the lease is kept while the engine may still run').not.toHaveBeenCalled();
        expect(engine.startCalls).toBe(0);

        // They come back while the old engine is still stopping: Start is held, never offered over a live engine.
        const back = await mountSessionPage();
        expect(primary(back).disabled, `while the old engine is stopping: ${describeControl(back)}`).toBe(true);

        // The engine proves itself off: the late retirement completes and the page offers a working Start.
        finishTermination();
        await act(async () => { await settle(60); });
        expect(controller.getState(), 'the late retirement finished the runtime').toBe('IDLE');
        expect(lease.release, 'the late retirement released the lease').toHaveBeenCalledTimes(1);
        expect(primary(back).disabled, `after the engine stopped: ${describeControl(back)}`).toBe(false);
        expect(['mic-start', 'mic-download']).toContain(primary(back).dataset.testid);

        engine.terminateGate = null;
        await recordAndSave(back, finishDownload);
    }, 60_000);
});
