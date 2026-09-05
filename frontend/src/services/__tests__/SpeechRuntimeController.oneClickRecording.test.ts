// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '../transcription/modes/types';
// Both the store and the intent module must be the instances the freshly-imported controller closes
// over. A top-level import survives `vi.resetModules()` and would be a DIFFERENT module object, so
// every assertion would read a store nothing writes to — which looked exactly like a silent product
// failure and was not one.
type Store = typeof import('@/stores/useSessionStore').useSessionStore;
let useSessionStore: Store;
type IntentApi = typeof import('../recordingIntent');
let intentApi: IntentApi;
const pendingRecordingIntent = () => intentApi.pendingRecordingIntent();
const lastRetiredIntent = () => intentApi.lastRetiredIntent();

/**
 * #1415 — ONE EXPLICIT MIC CLICK MUST BECOME EXACTLY ONE RECORDING.
 *
 * The Production failure, 4 Sep 2026: the first mic click started model preparation and the PO spoke
 * for roughly thirty seconds before noticing the microphone was off. #1259 measured the shape of it —
 * 113 and 126 seconds between readiness and a recording start — but measuring is not fixing.
 *
 * These drive the REAL controller and the REAL TranscriptionService, with a controlled engine at the
 * engine registry, which is the seam the registry documents itself as existing for. Nothing about the
 * service, the FSM, or the controller is faked: the cold path here reproduces the exact chain that
 * failed in Production — `checkAvailability` reports CACHE_MISS, the service FSM moves to
 * DOWNLOAD_REQUIRED, and `executeStrategy` throws TRANSCRIPTION_START_BLOCKED_STATE.
 */

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    // Must RESOLVE: the controller attaches .catch() to it on the FAILED path, and an undefined
    // return throws there — harness noise that masqueraded as a product failure.
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user' } } } }) },
    })),
}));

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

/**
 * A controlled engine at the REAL engine contract.
 *
 * A cold visit is signalled through `checkAvailability` returning CACHE_MISS — NOT by throwing from
 * `init`. Getting that wrong made the first version of this test reproduce a generic failure instead
 * of the actual cache miss, and it would have driven the fix to the wrong place.
 */
class ControlledEngine {
    public modelCached = false;
    public initCalls = 0;
    public startCalls = 0;
    public failStart: Error | null = null;
    public failInit: Error | null = null;
    /** False models a machine where the download never lands — preparation that cannot settle. */
    public downloadEnabled = true;

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
    async stop() { /* no-op */ }
    async resume() { /* no-op */ }
    async pause() { /* no-op */ }
    async terminate() { /* no-op */ }
    async getTranscript() { return ''; }
    getLastHeartbeatTimestamp() { return Date.now(); }
    getEngineType() { return 'transformers-js'; }
}

/**
 * Let queued lifecycle work settle.
 *
 * Microtask flushing alone is not enough: the resumed start is enqueued on the controller's own
 * lifecycle queue and its inner awaits cross macrotask boundaries, so a microtask-only drain observes
 * the moment BEFORE the recording begins and reports a false zero.
 */
const settle = async (turns = 12) => {
    for (let i = 0; i < turns; i += 1) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
};

describe('#1415 — one click, one recording', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;
    let trail: string[];

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        trail = [];

        // A FRESH MODULE GRAPH PER TEST. The controller is a singleton and carries terminated-engine
        // and lifecycle state between takes; poking its private fields covered some of that and not
        // all of it, which surfaced as ENGINE_ALREADY_TERMINATED leaking from one test into the next.
        vi.resetModules();

        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);

        // Imported AFTER resetModules so it is the very instance the controller closes over.
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();

        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        // The singleton carries state between tests; reset it to a cold tab.
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        priv.recordingStartedUnresolved = false;
        priv.pendingAttributionRetry = null;
        priv.pendingFullSaveRetry = null;

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
        useSessionStore.subscribe((st) => {
            const s = st.runtimeState;
            if (s && trail[trail.length - 1] !== s) trail.push(s);
        });
    });

    afterEach(() => vi.clearAllMocks());

    describe('the original failure', () => {
        it('PREPARATION IS NOT A START FAILURE — no error state, no discarded intent', async () => {
            // Before this change: TRANSCRIPTION_START_BLOCKED_STATE:DOWNLOAD_REQUIRED propagated as a
            // start failure, the runtime landed in FAILED_VISIBLE, and nothing remembered the click.
            // NOT awaited: the promise is the whole attempt and stays pending through preparation.
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* settled by a later assertion */ });
            await settle();

            expect(useSessionStore.getState().runtimeState).not.toBe('FAILED_VISIBLE');
            expect(useSessionStore.getState().sttStatus?.type).not.toBe('error');
            expect(trail).toContain('DOWNLOAD_REQUIRED');
        });

        it('the click SURVIVES preparation — it is never retired as a failure', async () => {
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* a refusal is asserted below, not here */ });
            await settle(60);
            // The intent either is still pending (preparation running) or was CLAIMED and started.
            // What it must never be is discarded as an acquisition failure, which is precisely what
            // the old code did the instant the service reported DOWNLOAD_REQUIRED.
            const retired = lastRetiredIntent();
            expect(retired?.reason).not.toBe('acquisition_failed');
            expect(pendingRecordingIntent() !== null || retired?.reason === 'started').toBe(true);
        });
    });

    describe('cold start', () => {
        it('reaches RECORDING exactly once, with no second click', async () => {
            const clickedAt = Date.now();
            // The caller's promise resolves ONLY when recording begins — see the assertion below.
            const started = controller.startRecording(POLICY as never, []);

            // Preparation runs through Production's own path: the click drove the download, the model
            // landed, and readiness follows. Nothing here forces a controller state — forcing READY
            // reused a service already parked in DOWNLOAD_REQUIRED and proved nothing.
            await settle(60);

            // ONE click, ONE engine start — and the route there passed through preparation, which is
            // what makes this the cold path rather than a warm one that happened to work.
            expect(engine.startCalls).toBe(1);
            expect(trail).toContain('DOWNLOAD_REQUIRED');
            expect(pendingRecordingIntent()).toBeNull();

            // #1415 (9) — the delay the user actually experienced, measured from the CLICK and
            // therefore including download and initialization. Measuring from readiness instead would
            // report a fast start for the session that felt like thirty seconds of silence.
            const intentToRecordingMs = Date.now() - clickedAt;
            expect(intentToRecordingMs).toBeGreaterThanOrEqual(0);

            // #1415 P1 — the ORIGINAL promise resolves, and only now. Before this it resolved as soon
            // as preparation began, so the caller pushed `session_started` with nothing recording.
            await expect(started).resolves.toBeUndefined();
        });

        it('a DUPLICATE readiness signal does not produce a second recording', async () => {
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* not the subject of this test */ });
            await settle(60);

            // A duplicate readiness signal after the resume has already happened.
            await (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition.bind(controller)('READY');
            await settle(30);

            // The intent is CLAIMED, not read: the second signal finds nothing to act on.
            expect(engine.startCalls).toBe(1);
        });
    });

    describe('#1415 P1 — engine and policy stay locked through preparation', () => {
        it('the lock is HELD while a click waits on a model download', async () => {
            engine.downloadEnabled = false;   // preparation stays open
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* asserted elsewhere */ });
            await settle();

            // `transition()` clears the synchronous start-intent lock on EVERY transition, and
            // preparation is a transition. Without the pending intent holding it, a mode or policy
            // change during the download would have the recording resume on an engine the user never
            // asked for, under a policy the intent was not minted with.
            expect(controller.isEngineSelectionLocked()).toBe(true);
        });

        it('the lock is RELEASED once that exact attempt is retired', async () => {
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* expected */ });
            await settle();
            expect(controller.isEngineSelectionLocked()).toBe(true);

            await (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition('TERMINATED');
            await settle();

            // The lock lasts exactly as long as the wish — no longer.
            expect(controller.isEngineSelectionLocked()).toBe(false);
        });
    });

    describe('#1415 P1 — the original Start promise is the whole attempt', () => {
        it('stays PENDING through preparation — it must not resolve before recording', async () => {
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            let settledEarly = false;
            void started.then(() => { settledEarly = true; }, () => { settledEarly = true; });
            await settle(20);

            // Resolving here is what let `session_started` be pushed with nothing recording.
            expect(settledEarly).toBe(false);
            expect(pendingRecordingIntent()).not.toBeNull();

            // Clean up the pending promise so the test does not leak an unhandled rejection.
            await (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition('TERMINATED');
            await settle();
        });

        it('REJECTS through the original caller when a resumed attempt cannot start', async () => {
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            const outcome = started.then(() => 'resolved', (e: Error) => e.message);
            await settle();
            await (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition('TERMINATED');
            await settle();

            // A resumed failure used to have no caller left to reject — it became an unhandled
            // rejection inside a void'd promise, invisible to the click that caused it.
            await expect(outcome).resolves.toBe('RECORDING_INTENT_RETIRED:teardown');
        });
    });

    describe('#1415 — a LATE download failure cannot cancel a newer intent', () => {
        it('A prepares, B supersedes, A\'s download rejects — B survives', async () => {
            // The real race at the real call site. `initiateModelDownload` is awaited asynchronously,
            // so its rejection can arrive after the user has clicked again and a newer intent exists.
            // EVERY rejector is captured, in order. A single holder is overwritten when B calls the
            // same spy, so rejecting it rejects B's download rather than A's — the test then exercises
            // the wrong attempt entirely and passes against the defect it exists to catch.
            //
            // (A bare `let` assigned only inside the executor also narrows to `never`, making the call
            // a silent no-op. Both mistakes produce a green test that proves nothing.)
            const rejectors: Array<(e: Error) => void> = [];
            const downloadSpy = vi
                .spyOn(controller as unknown as { initiateModelDownload: () => Promise<void> }, 'initiateModelDownload')
                .mockImplementation(() => new Promise<void>((_, reject) => { rejectors.push(reject); }));

            engine.downloadEnabled = false;
            const startedA = controller.startRecording(POLICY as never, []);
            startedA.catch(() => { /* A is expected to lose */ });
            await settle();

            const intentA = pendingRecordingIntent();
            expect(intentA).not.toBeNull();

            // The session is torn down and the runtime returns to IDLE — the state in which a user can
            // click again. A's download promise is STILL outstanding: nothing cancels it.
            const transition = (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition.bind(controller);
            await transition('TERMINATED');
            await settle();

            // The user clicks again. B is now the pending intent.
            const startedB = controller.startRecording(POLICY as never, []);
            startedB.catch(() => { /* not the subject */ });
            await settle();
            const intentB = pendingRecordingIntent();
            expect(intentB, 'B must be pending for this race to exist').not.toBeNull();
            expect(intentB?.token).not.toBe(intentA?.token);

            // NOW A's long-outstanding download finally rejects. Its rejector is the FIRST captured;
            // B's is separate and must stay pending.
            rejectors[0](new Error('DOWNLOAD_FAILED'));
            await settle(20);

            // B is untouched. Unscoped, A's failure would have retired it and silently cancelled a
            // recording the user is actively asking for.
            expect(pendingRecordingIntent()?.token).toBe(intentB?.token);
            downloadSpy.mockRestore();
        });
    });

    describe('the intent is retired when it must be', () => {
        it('teardown retires it — a stale intent must never start a recording later', async () => {
            // The download never lands, so preparation stays open and there is a live intent to
            // retire. With a working auto-start the intent is otherwise consumed before teardown.
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            const rejection = started.catch((e: Error) => e);
            await settle();
            expect(pendingRecordingIntent()).not.toBeNull();

            await (controller as unknown as { transition: (s: string) => Promise<void> })
                .transition('TERMINATED');
            await settle();

            expect(pendingRecordingIntent()).toBeNull();
            expect(lastRetiredIntent()?.reason).toBe('teardown');
            // The original caller is REJECTED, not left hanging: a wish that cannot be honoured must
            // surface where the click was made.
            await expect(rejection).resolves.toMatchObject({ message: 'RECORDING_INTENT_RETIRED:teardown' });
        });

        it('a later READY after teardown starts nothing', async () => {
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* expected: teardown retires the intent */ });
            await settle();
            const transition = (controller as unknown as { transition: (s: string) => Promise<void> }).transition
                .bind(controller);
            await transition('TERMINATED');
            // The model becomes available afterwards, and readiness arrives. There is no wish left,
            // so readiness is just readiness — this is the "navigation alone never records" property
            // expressed at the controller.
            engine.modelCached = true;
            await transition('READY');
            await settle(30);

            // This is the "navigation alone must never start recording" property, expressed at the
            // controller: after teardown there is no wish, so readiness is just readiness.
            expect(engine.startCalls).toBe(0);
        });
    });
});
