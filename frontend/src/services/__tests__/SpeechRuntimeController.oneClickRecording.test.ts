// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '../transcription/modes/types';
import logger from '../../lib/logger';
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

    describe('#1419 — a settled attempt cannot act on its successor', () => {
        type Priv = {
            transition: (s: string, e?: Error, t?: unknown, intentToken?: string) => Promise<void>;
            engineSelectionIntentLocked: boolean;
        };

        /** A prepares and is superseded by B, with the runtime returned to IDLE as a real teardown does. */
        const prepareAThenSupersedeWithB = async () => {
            engine.downloadEnabled = false;
            const a = controller.startRecording(POLICY as never, []);
            a.catch(() => { /* A is expected to lose */ });
            await settle();
            const aToken = pendingRecordingIntent()?.token;
            expect(aToken).toBeTruthy();

            // Teardown to IDLE — without this the bad-state guard retires B on arrival and the race
            // under test never exists. That is the mistake an earlier version of this suite made.
            await (controller as unknown as Priv).transition('TERMINATED');
            await (controller as unknown as Priv).transition('IDLE');
            await settle();

            const b = controller.startRecording(POLICY as never, []);
            b.catch(() => { /* not asserted here */ });
            await settle();
            const bToken = pendingRecordingIntent()?.token;
            expect(bToken).toBeTruthy();
            expect(bToken).not.toBe(aToken);
            return { aToken: aToken as string, bToken: bToken as string };
        };

        it('A late TERMINAL FAILURE from A does not retire B', async () => {
            // The user clicked again. B is what they are waiting on. A's failure arriving afterwards
            // must be A's business alone — unscoped, it cancelled the recording the user had just
            // asked for, with nothing on screen to explain why.
            const { aToken, bToken } = await prepareAThenSupersedeWithB();

            await (controller as unknown as Priv).transition('FAILED', new Error('A failed late'), undefined, aToken);
            await settle();

            expect(pendingRecordingIntent()?.token).toBe(bToken);
        });

        it('A reaching RECORDING does not settle B', async () => {
            // A finally succeeding after being superseded must not resolve B's promise or claim B's
            // attempt: the caller told "your recording started" has to be the caller whose click
            // started it, and B's audio must not carry A's attribution.
            const { aToken, bToken } = await prepareAThenSupersedeWithB();

            // `transition('RECORDING')` returns early unless the engine is ready and emissions are
            // safe. Without satisfying that guard the settle branch is never reached and this test
            // passes against the defect — which is exactly what it did on the first attempt.
            const priv = controller as unknown as Priv & { isEngineReady: boolean; isEmissionsSafe: boolean };
            priv.isEngineReady = true;
            priv.isEmissionsSafe = true;

            await (controller as unknown as Priv).transition('RECORDING', undefined, undefined, aToken);
            await settle();

            // B is still waiting on its own recording; A's late success is not B's success.
            expect(pendingRecordingIntent()?.token).toBe(bToken);
            expect(lastRetiredIntent()?.reason).not.toBe('started');
        });

        it('the engine stays locked for the WHOLE preparation interval, not just its first transition', async () => {
            // Asserted on the intent lock itself. `isEngineSelectionLocked()` ORs several unrelated
            // conditions, so it reports true during preparation even when this flag has been cleared —
            // which is why the existing behavioural test passes against the defect and this one does not.
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* asserted elsewhere */ });
            await settle();

            expect(pendingRecordingIntent()).not.toBeNull();
            expect((controller as unknown as Priv).engineSelectionIntentLocked).toBe(true);
        });

        it('and releases the moment that attempt settles', async () => {
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            started.catch(() => { /* expected */ });
            await settle();
            expect((controller as unknown as Priv).engineSelectionIntentLocked).toBe(true);

            await (controller as unknown as Priv).transition('TERMINATED');
            await settle();

            expect(pendingRecordingIntent()).toBeNull();
            expect((controller as unknown as Priv).engineSelectionIntentLocked).toBe(false);
        });
    });

    describe('#1419 — a gate that closes during preparation settles the waiting caller', () => {
        it('rejects the ORIGINAL promise instead of leaving the click waiting forever', async () => {
            // The gates are re-evaluated on the RESUMED start, which is right: a download takes
            // minutes and a gate open at click time can be shut by the time readiness arrives. But a
            // bare `return` there abandoned the promise the click is awaiting — the caller waits on a
            // start already decided against, and the user gets a status line they cannot act on.
            engine.downloadEnabled = false;
            const started = controller.startRecording(POLICY as never, []);
            const outcome: string[] = [];
            started.then(() => outcome.push('resolved'), (e: Error) => outcome.push(`rejected:${e.message}`));
            await settle();
            expect(pendingRecordingIntent()).not.toBeNull();

            // The gate closes WHILE preparation is in flight — a prior recording became unresolved.
            (controller as unknown as { recordingStartedUnresolved: boolean }).recordingStartedUnresolved = true;

            // Readiness arrives and the click resumes into the now-closed gate.
            engine.downloadEnabled = true;
            await (controller as unknown as { transition: (s: string) => Promise<void> }).transition('READY');
            await settle();

            expect(outcome.length, 'the original caller must be settled, not abandoned').toBe(1);
            expect(outcome[0]).toMatch(/^rejected:/);
            expect(outcome[0]).toContain('RECORDING_START_GATE_CLOSED');
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

/**
 * #1431 — RETRY THIS SET MUST START A SECOND TAKE.
 *
 * The ownership work rejects continuations from a superseded generation, which is right. What it must
 * not do is reject the LEGITIMATE next take: after a Focus Points review the user presses "Retry this
 * set", and that is an ordinary new recording on the same page, indistinguishable at the controller
 * from a first one except that state from the previous take still exists.
 *
 * The e2e that caught this asserts the session shell reaches `during` after the retry click. These
 * drive the controller directly so the failure is attributable to ownership rather than to routing.
 */
describe('#1431 — a completed take does not block the next one', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        // Warm: the retry path is not a cold start, and a cache miss here would test preparation
        // instead of ownership.
        engine.modelCached = true;

        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);

        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();

        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        priv.recordingStartedUnresolved = false;
        priv.pendingAttributionRetry = null;
        priv.pendingFullSaveRetry = null;

        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => vi.clearAllMocks());

    it('CASUALTY: after a take is saved and stopped, RETRY reaches RECORDING again', async () => {
        // Take one: the set the user just practised.
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

        await controller.stopRecording();
        await settle(30);

        // "Retry this set" — a second take on the same page, with take one's state still around.
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        // The whole finding: the second take must actually record. A retry that silently does nothing
        // leaves the user pressing a button that looks live and produces no session.
        expect({ state: useSessionStore.getState().runtimeState, starts: engine.startCalls })
            .toEqual({ state: 'RECORDING', starts: 2 });
    });

    it('CASUALTY: a producer-integrity teardown that finishes AFTER a reset does not fail the successor', async () => {
        // The callback that reaches `failProducerIntegrity` is generation-bound at entry, which only
        // establishes that A was current when it was CALLED. `stopTranscription()` inside it is a real
        // suspension point, and a reset can replace A while it is pending — after which marking
        // `recordingStartedUnresolved`, arming recovery and the UNSCOPED transition to FAILED would all
        // land on successor B. B's take would be failed because A's engine changed identity.
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            service: { stopTranscription?: () => Promise<void> } | null;
            serviceGeneration: number;
            recordingStartedUnresolved: boolean;
            failProducerIntegrity: (mode: unknown) => Promise<void>;
        };

        let releaseStop!: () => void;
        priv.service!.stopTranscription = () => new Promise<void>((resolve) => { releaseStop = () => resolve(); });

        priv.recordingStartedUnresolved = false;
        const teardown = priv.failProducerIntegrity('browser');
        await settle(2);

        // The reset: a successor replaces A while A's stop is still pending.
        priv.serviceGeneration += 1;

        releaseStop();
        await teardown;
        await settle(10);

        // The successor is untouched: not marked unresolved, and not transitioned to FAILED by A.
        // The user-visible consequence Codex names: A's teardown must not transition the successor to
        // FAILED. That is what a reader of this screen would experience — a take that was recording
        // fine, failed by the previous take's engine.
        expect({ state: useSessionStore.getState().runtimeState, unresolved: priv.recordingStartedUnresolved })
            .toEqual({ state: expect.not.stringMatching(/^FAILED/), unresolved: false });
    });

    it('CONTROL: a start that never reaches RECORDING is not published as one', async () => {
        // NOT a casualty for the invariant-ordering fix, and labelled CONTROL so it does not look like
        // one. It drives a start that THROWS; the finding is about a start that RESOLVES through a
        // non-recording early return, which this harness cannot produce — the service is real and its
        // FSM is driven by the controlled engine. Moving the invariant call back before the
        // service-state check leaves this test green, so it is not evidence for that fix.
        //
        // It is kept because the property it does assert is worth holding: a refused start must never
        // be reported as a recording.
        engine.failStart = new Error('engine refused to start');

        await controller.startRecording(POLICY as never, []).catch(() => { /* the refusal is the subject */ });
        await settle(30);

        expect({ state: useSessionStore.getState().runtimeState })
            .not.toEqual({ state: 'RECORDING' });
    });

    it('CASUALTY: a save that resolves AFTER a reset does not write its id over the successor', async () => {
        // `saveSession` is a real suspension point. A hard reset during it can advance the lifecycle and
        // establish a successor take; take A resolving afterwards would write A's database id into
        // `this.sessionId`, mark the store persisted, and rebind shadow state — a saved session bound to
        // the wrong recording. The ownership question has to be asked again AFTER the await, not only
        // after `startTranscription`.
        const storage = await import('../../lib/storage');
        let releaseSave!: (v: unknown) => void;
        vi.mocked(storage.saveSession).mockReturnValueOnce(
            new Promise((resolve) => { releaseSave = resolve; }) as never,
        );

        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as { sessionId: string | null; lifecycleVersion: number };
        priv.sessionId = null;

        // The hard reset: the lifecycle moves on while A's save is still in flight.
        priv.lifecycleVersion += 1;

        releaseSave({ session: { id: 'A-row' }, usageExceeded: false });
        await settle(30);

        // A's row exists in the database and is not lost — it is simply no longer ours to bind.
        expect({ boundSessionId: priv.sessionId }).toEqual({ boundSessionId: null });
    });

    it('CASUALTY: the second take gets its OWN callbacks — the first take\'s are the ones dropped', async () => {
        // Generation binding drops callbacks from a superseded service. Wrapping each generation around
        // the PREVIOUS generation's wrappers compounds those guards, so take two's callbacks would sit
        // inside take one's check — false the moment take two exists — and every callback for every
        // service after the first would be silently dropped. Found by this casualty, fixed by wrapping
        // the unwrapped originals each time.
        const priv = controller as unknown as {
            serviceCallbacks: Record<string, ((...a: unknown[]) => void) | undefined>;
        };

        await controller.startRecording(POLICY as never, []);
        await settle(30);
        const takeOneCallbacks = { ...priv.serviceCallbacks };

        await controller.stopRecording();
        await settle(30);
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        const takeTwoCallbacks = { ...priv.serviceCallbacks };

        const droppedCount = () => vi.mocked(logger.debug).mock.calls.filter(
            ([, msg]) => typeof msg === 'string' && msg.includes('superseded service generation'),
        ).length;

        // Take TWO's callback is live: invoking it is not reported as a drop.
        const beforeLive = droppedCount();
        takeTwoCallbacks.onHistoryUpdate?.([]);
        const afterLive = droppedCount();

        // Take ONE's callback belongs to a superseded generation and IS dropped.
        takeOneCallbacks.onHistoryUpdate?.([]);
        const afterStale = droppedCount();

        expect({ liveWasDropped: afterLive > beforeLive, staleWasDropped: afterStale > afterLive })
            .toEqual({ liveWasDropped: false, staleWasDropped: true });
    });
});

/**
 * #1431 — A SUPERSEDED TERMINAL TRANSITION MUST STILL WITHDRAW ITS OWN CLAIM.
 *
 * CORRECTION: this was originally written up as the cause of the Focus Points Retry failure. The
 * runtime trace disproved that. Finalization TERMINATES normally — the logs show
 * `transition READY starting` / `STOPPING → READY` / `transition READY done` — and the retry failure is
 * a successor-admission defect covered separately below. The screenshot alone made finalization look
 * stuck; the ordered logs showed it was not.
 *
 * The defect below is real on its own terms and is kept for that reason, not as an e2e explanation.
 *
 * `isTranscriptFinalizing` is cleared in exactly ONE place: the resting-state branch of `transition()`.
 * The ownership work added a guard at the TOP of `transition()` that returns for any stale or cancelled
 * token — before that branch runs. So a terminal transition presented with a superseded token silently
 * does nothing, and the banner stays latched for the rest of the session.
 *
 * Ownership is the right rule for state a stale continuation would CORRUPT. It is the wrong rule for
 * releasing a user-visible claim: "stop saying we are finalizing" is the removal of a claim, not the
 * assertion of one, and refusing it leaves the product wedged.
 */
describe('#1431 — a superseded terminal transition still releases the finalizing banner', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;

    beforeEach(async () => {
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        const engine = new ControlledEngine();
        engine.modelCached = true;
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        useSessionStore.getState().resetSession();
    });

    it('CASUALTY: a terminal transition with a SUPERSEDED token clears the banner', async () => {
        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            transition: (s: string, e?: Error, t?: { cancelled: boolean; version: number }) => Promise<void>;
        };
        useSessionStore.getState().setTranscriptFinalizing(true);

        // The stop's own token, superseded while finalization was running. The latch is THIS take's —
        // nothing newer has armed it — so this take may withdraw its own claim.
        const staleToken = { cancelled: false, version: priv.lifecycleVersion };
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        priv.lifecycleVersion += 1;

        await priv.transition('READY', undefined, staleToken);

        // The user must not be left looking at "Finalizing your transcript…" forever for a take that
        // has already finished. Whoever owns the lifecycle now, nobody is finalizing.
        expect({ finalizing: useSessionStore.getState().isTranscriptFinalizing })
            .toEqual({ finalizing: false });
    });

    it('CASUALTY: a stale take may NOT clear a latch a SUCCESSOR now owns', async () => {
        // The latch is one global boolean and it is the start guard in `useSessionLifecycle`: while it is
        // true the record control is disabled. A superseded take A clearing it while successor B is still
        // saving would admit take C into a session B has not finished writing — a worse defect than the
        // stale banner the withdrawal exists to prevent.
        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            transition: (s: string, e?: Error, t?: { cancelled: boolean; version: number }) => Promise<void>;
        };

        // A armed the latch, then was superseded; B re-armed it under the new lifecycle.
        const aToken = { cancelled: false, version: priv.lifecycleVersion };
        priv.lifecycleVersion += 1;
        useSessionStore.getState().setTranscriptFinalizing(true);
        priv.finalizingOwnerVersion = priv.lifecycleVersion;   // B owns it now

        await priv.transition('READY', undefined, aToken);

        // B is still finalizing. A must not have spoken for it.
        expect({ finalizing: useSessionStore.getState().isTranscriptFinalizing })
            .toEqual({ finalizing: true });
    });

    /**
     * NOTE — the Start-guard casualty does NOT live here, and the one that did has been removed.
     *
     * It asserted `isTranscriptFinalizing` and claimed to assert the guard's refusal. It did not: it
     * re-read the same boolean the latch test above already covers, so a regression removing the check
     * in `useSessionLifecycle.handleStartStop` would have left it green while take C was admitted during
     * B's finalization. Codex caught that, and it is the exact failure mode — a casualty passing for a
     * reason unrelated to what it names — that this branch has been correcting elsewhere.
     *
     * The real guard is exercised where it lives, against the mounted hook, in
     * `useSessionLifecycle.test.tsx`: "#1431: a start is REFUSED while a previous take is still
     * finalizing", which drives `handleStartStop` and asserts `startRecording` is never called.
     */

    it("CASUALTY: the latch clears normally when B reaches ITS OWN resting terminal", async () => {
        // The other half: ownership must not make the latch un-clearable. B's own terminal transition
        // releases it, and releases the ownership with it, so a later legitimate withdrawal is not
        // blocked by a stale owner.
        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            transition: (s: string, e?: Error, t?: { cancelled: boolean; version: number }) => Promise<void>;
        };
        useSessionStore.getState().setTranscriptFinalizing(true);
        priv.finalizingOwnerVersion = priv.lifecycleVersion;

        // B's own resting transition — its token is current, so it takes the ordinary path.
        await priv.transition('READY', undefined, { cancelled: false, version: priv.lifecycleVersion });

        expect({
            finalizing: useSessionStore.getState().isTranscriptFinalizing,
            ownerReleased: priv.finalizingOwnerVersion,
        }).toEqual({ finalizing: false, ownerReleased: null });
    });

    it('CASUALTY: a CANCELLED token also releases it', async () => {
        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            transition: (s: string, e?: Error, t?: { cancelled: boolean; version: number }) => Promise<void>;
        };
        useSessionStore.getState().setTranscriptFinalizing(true);
        priv.finalizingOwnerVersion = priv.lifecycleVersion;   // this take armed it

        await priv.transition('TERMINATED', undefined, { cancelled: true, version: priv.lifecycleVersion });

        expect({ finalizing: useSessionStore.getState().isTranscriptFinalizing })
            .toEqual({ finalizing: false });
    });
});

/**
 * #1431 — A STOP THAT PERSISTS MUST FINISH FINALIZING.
 *
 * CORRECTION: written while the stop was believed to be wedged. The trace shows it is not — this passes
 * on the failing head too. It is retained as a REGRESSION GUARD on the stop sequence, not as evidence
 * about the Focus Points Retry failure, whose real boundary is successor admission.
 */
describe('#1431 — a stop that persists must finish finalizing', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        engine.modelCached = true;
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => vi.clearAllMocks());

    it('CASUALTY: after a stop, the runtime rests and the finalizing claim is withdrawn', async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

        await controller.stopRecording();
        await settle(40);

        // The two facts the wedged journey violates, asserted at the boundary rather than downstream.
        expect({
            finalizing: useSessionStore.getState().isTranscriptFinalizing,
            resting: ['READY', 'IDLE', 'TERMINATED'].includes(useSessionStore.getState().runtimeState ?? ''),
        }).toEqual({ finalizing: false, resting: true });
    });
});


/**
 * #1431 — SUCCESSOR ADMISSION: the controller must say what the engine is actually doing.
 *
 * The runtime trace from the failing e2e is unambiguous. After a completed take the retry is received,
 * the controller reaches INITIATING, the service FSM reaches RECORDING — and no corresponding
 * controller transition to RECORDING ever appears. The engine is capturing audio while the product
 * still represents the session as initiating: no truthful recording state, and no Stop control.
 *
 * The cause is the intent handoff. `isCurrentIntent` is the correct authority BEFORE an intent is
 * claimed and the wrong one after, because claiming is precisely what stops it being pending. Removing
 * that check would restore the stale-attempt race this branch exists to prevent, so the handoff is made
 * explicit: the accepted attempt records the tuple that owns the publish, and only that tuple may make
 * it.
 */
describe('#1431 — successor admission', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        engine.modelCached = true;              // a retry is a WARM start, which is where this fails
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE';
        priv.service = null;
        priv.isEngineReady = false;
        priv.acceptedAttempt = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => vi.clearAllMocks());

    it('CASUALTY A: a WARM successor take is admitted — service recording AND controller recording', async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        await controller.stopRecording();
        await settle(30);

        // The retry. Its caller must resolve, exactly once, and the controller must publish RECORDING —
        // the engine capturing audio while the product says INITIATING is the defect.
        let resolutions = 0;
        await controller.startRecording(POLICY as never, []).then(() => { resolutions += 1; });
        await settle(30);

        const priv = controller as unknown as { service: { getState?: () => string } | null };
        expect({
            controller: useSessionStore.getState().runtimeState,
            service: priv.service?.getState?.(),
            callerResolvedOnce: resolutions,
        }).toEqual({ controller: 'RECORDING', service: 'RECORDING', callerResolvedOnce: 1 });
    });

    it('CASUALTY B: a CLAIMED intent still owns its own attempt', async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        // The intent that produced this recording is no longer pending — claiming it is what accepted it.
        // The accepted attempt must nonetheless still be the recognised owner, or the controller can
        // never publish the state of the take it just started.
        expect(pendingRecordingIntent()).toBeNull();
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

        const priv = controller as unknown as {
            acceptedAttempt: { intentToken: string } | null;
            mayPublishRecording: (t?: string) => boolean;
        };
        const accepted = priv.acceptedAttempt;
        expect({ hasAcceptedOwner: accepted !== null }).toEqual({ hasAcceptedOwner: true });
        expect({ acceptedMayPublish: priv.mayPublishRecording(accepted!.intentToken) })
            .toEqual({ acceptedMayPublish: true });
    });

    it('CASUALTY C: a SUPERSEDED attempt may not publish for its successor', async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            acceptedAttempt: { intentToken: string } | null;
            lifecycleVersion: number;
            serviceGeneration: number;
            mayPublishRecording: (t?: string) => boolean;
        };
        const supersededToken = priv.acceptedAttempt!.intentToken;

        // B takes over: the lifecycle moves on.
        priv.lifecycleVersion += 1;

        expect({ supersededMayPublish: priv.mayPublishRecording(supersededToken) })
            .toEqual({ supersededMayPublish: false });
    });

    /**
     * Supersession does not always look the same, and each term of the tuple is load-bearing on its own.
     * A reset that bumps the lifecycle, a service replaced beneath the same lifecycle, and a new
     * recording id are three different ways for an attempt to stop being the current one — a tuple that
     * only checked the lifecycle would admit the other two.
     */
    it.each([
        ['the SERVICE is replaced beneath it', 'serviceGeneration'],
        ['a NEW RECORDING takes over', 'recordingId'],
    ])('CASUALTY C2: a superseded attempt may not publish when %s', async (_label, term) => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            acceptedAttempt: { intentToken: string } | null;
            serviceGeneration: number;
            currentRecordingId: string | null;
            mayPublishRecording: (t?: string) => boolean;
        };
        const supersededToken = priv.acceptedAttempt!.intentToken;

        if (term === 'serviceGeneration') priv.serviceGeneration += 1;
        else priv.currentRecordingId = 'a-different-recording';

        expect({ term, supersededMayPublish: priv.mayPublishRecording(supersededToken) })
            .toEqual({ term, supersededMayPublish: false });
    });

    it('CASUALTY C3: a service swapped WITHOUT a generation bump still loses the attempt', async () => {
        // Today every replacement goes through `callbacksForNewService()` or `detachService()`, both of
        // which bump the generation — so this term is currently redundant with the generation check and
        // a mutant removing it survives on the other casualties alone.
        //
        // It is kept, and covered here, because the redundancy is a property of today's call sites
        // rather than of the invariant. The invariant is "the attempt's own service is still the live
        // one". A future path that swaps the service without going through those two helpers would
        // otherwise let a superseded attempt publish for a service it never started, and nothing else in
        // the tuple would notice.
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            acceptedAttempt: { intentToken: string } | null;
            service: unknown;
            mayPublishRecording: (t?: string) => boolean;
        };
        const token = priv.acceptedAttempt!.intentToken;
        expect({ beforeSwap: priv.mayPublishRecording(token) }).toEqual({ beforeSwap: true });

        // A different service instance, with every other term of the tuple untouched.
        priv.service = { getState: () => 'RECORDING', fsm: { is: (st: string) => st === 'RECORDING' } };

        expect({ afterSwap: priv.mayPublishRecording(token) }).toEqual({ afterSwap: false });
    });

    it('CASUALTY D: a service that is NOT recording cannot be published as recording', async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            acceptedAttempt: { intentToken: string; service: { getState?: () => string } } | null;
            mayPublishRecording: (t?: string) => boolean;
        };
        const accepted = priv.acceptedAttempt!;
        // The service reports something other than RECORDING — the false-success shape, where
        // `startTranscription` returns through a non-recording early exit.
        accepted.service.getState = () => 'READY';

        expect({ mayPublish: priv.mayPublishRecording(accepted.intentToken) })
            .toEqual({ mayPublish: false });
    });
});


/**
 * #1431 — THE REAL STOP TERMINAL, not `transition()` in isolation.
 *
 * The previous guard casualty called `transition()` directly and therefore never reached the stop's own
 * terminal teardown — where the lifecycle is bumped, the finalizing latch cleared, working memory
 * purged, and READY published through a `transition()` call that passes NO token and so cannot be
 * refused. Codex was right that the unit test passed while that production path stayed exposed.
 *
 * This drives `stopRecording()` itself, with a successor established while the stop is suspended.
 */
describe('#1431 — a superseded stop terminal leaves the successor alone', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        engine.modelCached = true;
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE'; priv.service = null; priv.isEngineReady = false;
        priv.acceptedAttempt = null; priv.finalizingOwnerVersion = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => vi.clearAllMocks());

    it("CASUALTY: stale A's stop terminal does not clear B's latch, purge B's transcript, or rest B", async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            service: { destroy?: () => Promise<void> } | null;
        };

        // A's teardown suspends inside `service.destroy()` — a real await in the terminal block.
        let releaseDestroy!: () => void;
        const original = priv.service!.destroy!.bind(priv.service);
        priv.service!.destroy = () => new Promise<void>((resolve) => {
            releaseDestroy = () => { void original(); resolve(); };
        });

        const stopping = controller.stopRecording();
        await settle(6);

        // B takes over while A is suspended, and B arms its own finalization.
        priv.lifecycleVersion += 1;
        useSessionStore.getState().setTranscriptFinalizing(true);
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        useSessionStore.getState().setRuntimeState('STOPPING');

        releaseDestroy();
        await stopping.catch(() => { /* A's own outcome is not the subject */ });
        await settle(30);

        // B is untouched: still finalizing, still owning the latch, not rested by A.
        expect({
            finalizing: useSessionStore.getState().isTranscriptFinalizing,
            latchOwner: priv.finalizingOwnerVersion,
            restedByA: useSessionStore.getState().runtimeState === 'READY',
        }).toEqual({
            finalizing: true,
            latchOwner: priv.lifecycleVersion,
            restedByA: false,
        });
    });
});


    /**
     * The detach result is a SECOND, independent ownership signal.
     *
     * The version recheck above catches a successor that moved the lifecycle. It cannot catch one that
     * replaced the live service without doing so — and in that case `detachService(expected)` returning
     * null is the only thing standing between a stale stop and the successor's state. Superseding by
     * lifecycle alone leaves that branch unexercised, which is exactly what mutation testing showed.
     */
describe('#1431 — the detach result is an ownership signal, not a no-op', () => {
    let controller: import('../SpeechRuntimeController').SpeechRuntimeController;
    let engine: ControlledEngine;

    beforeEach(async () => {
        localStorage.clear();
        engine = new ControlledEngine();
        engine.modelCached = true;
        vi.resetModules();
        const { sttRegistry } = await import('../transcription/STTRegistry');
        sttRegistry.register('transformers-js', () => engine as never);
        sttRegistry.register('private', () => engine as never);
        useSessionStore = (await import('@/stores/useSessionStore')).useSessionStore;
        intentApi = await import('../recordingIntent');
        intentApi.__resetRecordingIntentForTests();
        const mod = await import('../SpeechRuntimeController');
        controller = mod.speechRuntimeController;
        const priv = controller as unknown as Record<string, unknown>;
        priv.state = 'IDLE'; priv.service = null; priv.isEngineReady = false;
        priv.acceptedAttempt = null; priv.finalizingOwnerVersion = null;
        useSessionStore.getState().resetSession();
        useSessionStore.getState().setRuntimeState('IDLE');
    });

    afterEach(() => vi.clearAllMocks());

    it("CASUALTY C: the rightful owner completes its OWN terminal and the next take can start", async () => {
        // Ownership must not make the terminal unreachable. B's own stop clears B's latch and frozen
        // snapshot, purges B's working memory, rests the runtime, releases B's terminal ownership — and
        // the next legitimate take starts. Without this, every guard above could be satisfied by a stop
        // path that simply never completes.
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');

        await controller.stopRecording();
        await settle(40);

        const priv = controller as unknown as { finalizingOwnerVersion: number | null };
        expect({
            finalizing: useSessionStore.getState().isTranscriptFinalizing,
            frozen: useSessionStore.getState().frozenTranscriptAtStop,
            ownerReleased: priv.finalizingOwnerVersion,
            resting: ['READY', 'IDLE', 'TERMINATED'].includes(useSessionStore.getState().runtimeState ?? ''),
        }).toEqual({ finalizing: false, frozen: null, ownerReleased: null, resting: true });

        // ...and the next legitimate take is admitted.
        await controller.startRecording(POLICY as never, []);
        await settle(30);
        expect(useSessionStore.getState().runtimeState).toBe('RECORDING');
    });

    it("CASUALTY: a successor that replaces the SERVICE without moving the lifecycle is still respected", async () => {
        await controller.startRecording(POLICY as never, []);
        await settle(30);

        const priv = controller as unknown as {
            lifecycleVersion: number;
            finalizingOwnerVersion: number | null;
            service: { destroy?: () => Promise<void> } | null;
        };

        let releaseDestroy!: () => void;
        const original = priv.service!.destroy!.bind(priv.service);
        priv.service!.destroy = () => new Promise<void>((resolve) => {
            releaseDestroy = () => { void original(); resolve(); };
        });

        const stopping = controller.stopRecording();
        await settle(6);

        // B takes the service WITHOUT touching the lifecycle: the version recheck cannot see this, so
        // only the detach result can.
        priv.service = { getState: () => 'RECORDING', destroy: async () => {}, fsm: { is: (st: string) => st === 'RECORDING' } } as never;
        useSessionStore.getState().setTranscriptFinalizing(true);
        priv.finalizingOwnerVersion = priv.lifecycleVersion;
        useSessionStore.getState().setRuntimeState('STOPPING');

        releaseDestroy();
        await stopping.catch(() => { /* A's own outcome is not the subject */ });
        await settle(30);

        expect({
            finalizing: useSessionStore.getState().isTranscriptFinalizing,
            serviceStillBs: priv.service !== null,
            restedByA: useSessionStore.getState().runtimeState === 'READY',
        }).toEqual({ finalizing: true, serviceStillBs: true, restedByA: false });
    });
});
