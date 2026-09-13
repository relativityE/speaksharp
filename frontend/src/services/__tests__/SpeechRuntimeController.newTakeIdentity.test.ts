// @vitest-environment jsdom
/**
 * #1422 — A NEW TAKE SUPERSEDES THE PREVIOUS TAKE'S COMPLETED-SESSION IDENTITY.
 *
 * The review reader falls back to `completedSessionId` so an optional reconciliation failure cannot take
 * a saved transcript away. That fallback is only safe while the id belongs to the take on screen.
 *
 * `startRecording` already clears `finalizedAnalysis` and the objective coverage rail at the new-recording
 * boundary, for exactly this reason. `completedSessionId` was left behind — so on "Practice this again"
 * the after-state could authorize an automatic review request for the PREVIOUS session: stale coaching
 * replayed, its telemetry duplicated, and a generation spent from the user's daily budget on the wrong
 * take.
 *
 * THE FIRST FIX RETIRED IT TOO EARLY. Clearing at the start boundary assumes the start succeeds, and
 * everything that can still refuse — lock, auth, microphone, acquisition, engine start — comes after it.
 * A refusal then left the user with NO take at all: the previous review's identity gone, no successor,
 * and the review surface stuck on "Loading…" with nothing left to read. Denying the microphone cost you
 * the transcript you had just finished reading.
 *
 * So retirement moved to CONFIRMED RECORDING ADMISSION — the producer latch, the first moment a
 * successor certainly exists. These two casualties are the pair that pins it: a failed start must
 * PRESERVE the previous review, and a confirmed admission must retire it.
 *
 * This drives the REAL controller boundary rather than setting the store by hand. A page-level test that
 * cleared the id itself would pass whether or not the controller ever did — which is precisely the shape
 * of casualty this program keeps having to correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { __resetRecordingIntentForTests } from '../recordingIntent';
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
// The admission journey below runs a start all the way to CONFIRMED RECORDING, so the network
// boundary it crosses on the way has to exist. Only the server is stubbed; the controller is real.
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    })),
}));

/**
 * A service that CONFIRMS it is recording. Admission is gated on the service's own answer (#1431), so a
 * take that never gets one never reaches the retirement — which is exactly why the earlier attempt at
 * casualty B proved nothing.
 */
const recordingService = (overrides: Record<string, unknown> = {}) => ({
    isServiceDestroyed: () => false,
    warmUp: vi.fn().mockResolvedValue(undefined),
    getMode: vi.fn().mockReturnValue('private'),
    getStrategy: vi.fn().mockReturnValue(null),
    getState: vi.fn().mockReturnValue('RECORDING'),
    getMetadata: vi.fn().mockReturnValue({
        engineVersion: 'test-engine', modelName: 'test-model', deviceType: 'browser',
    }),
    startTranscription: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    setSessionId: vi.fn(),
    updateCallbacks: vi.fn(),
    fsm: { is: vi.fn((state: string) => state === 'RECORDING') },
    ...overrides,
});

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => { resolve = settle; });
    return { promise, resolve };
};

const newController = () => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    return new Controller() as unknown as PrivateController & {
        lifecycleVersion: number;
        serviceGeneration: number;
        acceptedAttempt: { recordingId: string } | null;
        isEngineReady: boolean;
        isEmissionsSafe: boolean;
        hardResetAwaited: (reason: string) => Promise<void>;
    };
};

type PrivateController = {
    newRecordingBoundary?: unknown;
    state: string;
    service: unknown;
    sessionId: string | null;
    startRecording: (policy: unknown, words: string[]) => Promise<unknown>;
};

const priv = () => SpeechRuntimeController.getInstance() as unknown as PrivateController;

const POLICY = {
    allowNative: false, allowCloud: false, allowPrivate: true,
    preferredMode: 'private', allowFallback: false, executionIntent: 'test',
};

describe('#1422 — a new take clears the previous take\'s completed-session identity', () => {
    beforeEach(() => {
        __resetRecordingIntentForTests();
        useSessionStore.getState().resetSession?.();
        const c = priv();
        c.service = null;
        c.sessionId = null;
        c.state = 'READY';
    });

    it('CASUALTY: a FAILED start preserves the previous take\'s review instead of stranding it', async () => {
        // The state after take one saved: an id the review reader would fall back to.
        useSessionStore.getState().setCompletedSessionId('session-take-one');
        useSessionStore.getState().setFinalizedAnalysis(null);
        expect(useSessionStore.getState().completedSessionId).toBe('session-take-one');

        // Take two is attempted and REFUSED — there is no engine in this harness, which stands in for
        // every real refusal after the start boundary: the lock, auth, a denied microphone, a failed
        // acquisition. No successor exists at the end of this.
        await priv().startRecording(POLICY as never, []).catch(() => { /* the refusal IS the subject */ });

        // The user still has the take they were reading. Retiring it here would leave the review
        // surface loading forever with nothing to load.
        expect({ completedSessionId: useSessionStore.getState().completedSessionId })
            .toEqual({ completedSessionId: 'session-take-one' });
    });

    it('CASUALTY A: a FAILED start preserves the COMPLETE prior after-state, not just its identity', async () => {
        // The release outcome is preservation of A's whole review until B genuinely exists. Keeping the
        // identity while dropping the analysis and the N/N coverage leaves half an after-state on
        // screen: a readable transcript beside a review that has silently lost its result.
        const store = useSessionStore.getState();
        store.setCompletedSessionId('session-take-one');
        store.setFinalizedAnalysis({ sessionId: 'session-take-one' } as never);
        store.setObjectiveCoverageResult([
            { id: 'fp-0', label: 'Name the price', status: 'covered' },
        ] as never);

        // Take two is attempted and REFUSED — no engine here, standing in for every real refusal after
        // the start boundary: the lock, auth, a denied microphone, a failed acquisition.
        await priv().startRecording(POLICY as never, []).catch(() => { /* the refusal IS the subject */ });

        const after = useSessionStore.getState();
        expect(after.completedSessionId, "A's transcript stays addressable").toBe('session-take-one');
        expect(after.finalizedAnalysis, "A's settled review survives").not.toBeNull();
        expect(after.objectiveCoverageResult, "A's N/N coverage survives").not.toBeNull();
    });

    it('CASUALTY B: a CONFIRMED admission retires all three after-state signals together', async () => {
        /**
         * The half of the pair casualty A cannot prove. A only shows the after-state SURVIVING a
         * refusal, which a controller that never retires anything also satisfies — so on its own it
         * argues for the bug it was written against. B is what makes A a boundary rather than a
         * one-sided preference.
         *
         * The earlier attempt at this was not achieved: with no engine attached the start never reached
         * admission, so deleting the retirement block outright left it green. Admission is gated on the
         * SERVICE confirming RECORDING (#1431), so the service has to answer.
         */
        const c = newController();
        c.state = 'READY';
        c.service = recordingService() as never;

        // A is saved and on screen: transcript addressable, review settled, coverage complete.
        const store = useSessionStore.getState();
        store.setCompletedSessionId('session-A');
        store.setFinalizedAnalysis({ sessionId: 'session-A' } as never);
        store.setObjectiveCoverageResult([
            { id: 'fp-0', label: 'Name the price', status: 'covered' },
            { id: 'fp-1', label: 'State the guarantee', status: 'covered' },
        ] as never);

        await c.startRecording(POLICY as never, []);

        // The admission actually happened. Without this the three assertions below would also pass on a
        // start that refused early and left the store untouched by accident — the precise way the
        // previous version of this casualty passed for the wrong reason.
        expect(c.acceptedAttempt, 'B was admitted; this is not a refusal').not.toBeNull();

        const after = useSessionStore.getState();
        expect(after.completedSessionId, "A's identity is retired").toBeNull();
        expect(after.finalizedAnalysis, "A's review is retired").toBeNull();
        expect(after.objectiveCoverageResult, "A's coverage is retired").toBeNull();
    });

    it('B2: a superseded take returning RECORDING late retires nothing of the successor\'s', async () => {
        /**
         * THE JOURNEY IS REAL; THE CLAIM IS NARROWER THAN ITS FIRST DRAFT. Read the disclosure.
         *
         * `startTranscription()` is a genuine suspension point: A enters it, loses the lifecycle to a
         * hard reset, and returns reporting RECORDING afterwards. That is driven here, not simulated —
         * the fake service signals when A is actually inside the call, because waiting a fixed number
         * of microtasks instead left A still upstream of it, never resuming, and the first draft of
         * this casualty passed on a journey that never happened.
         *
         * DISCLOSED — THIS DOES NOT PIN THE RETIREMENT'S PLACEMENT. I mutated the source to find out
         * rather than reasoning about it. Instrumenting A's path shows it stops at
         * `checkRecordingInvariant`, which throws for a take that no longer owns the lifecycle: the
         * producer latch is reached, the invariant is entered, and nothing after it runs. The
         * retirement site is therefore UNREACHABLE for a superseded take, and no single-line mutation
         * of it can be killed here — moving the block above the `_token.cancelled` check leaves this
         * green, and so does neutering `stillOursBeforeRecording()` as well.
         *
         * What that means is worth stating plainly: the successor's after-state is defended by #1431's
         * ownership guards, not by where #1422 put the retirement. The placement is still correct and
         * still necessary — casualty B proves the block runs on a legitimate admission — but its
         * `acceptedAttempt` re-read is defence in depth with NO discriminating casualty, because
         * producing one needs a successor accepted between the latch and the check, which this
         * boundary cannot be made to do honestly.
         *
         * So this test earns its place as the composite user-facing property — a superseded take must
         * not take the successor's finished review off the screen — and not as proof of the ordering.
         */
        const c = newController();
        c.state = 'READY';
        const aStart = deferred();
        const aEntered = deferred();
        c.service = recordingService({
            startTranscription: vi.fn().mockImplementation(() => {
                // A HAS TO ACTUALLY BE SUSPENDED HERE before the lifecycle moves. Waiting a fixed
                // number of microtasks instead left A still upstream of this call, so it never resumed
                // and the test proved nothing — the first version of this casualty failed exactly that
                // way, and passed anyway.
                aEntered.resolve();
                return aStart.promise;
            }),
        }) as never;

        const aRunning = c.startRecording(POLICY as never, []).catch(() => { /* A loses; that is the point */ });
        await aEntered.promise;

        // A is now suspended inside startTranscription. The lifecycle moves on without it.
        await c.hardResetAwaited('supersede-A');

        // B owns the screen: its own saved take, its own settled review, its own coverage.
        const store = useSessionStore.getState();
        store.setCompletedSessionId('session-B');
        store.setFinalizedAnalysis({ sessionId: 'session-B' } as never);
        store.setObjectiveCoverageResult([{ id: 'fp-0', label: 'B point', status: 'covered' }] as never);

        // A returns, reporting RECORDING, into a lifecycle it no longer owns.
        aStart.resolve();
        await aRunning;

        const after = useSessionStore.getState();
        expect(after.completedSessionId, "B's identity survives A's late return").toBe('session-B');
        expect(after.finalizedAnalysis, "B's review survives").not.toBeNull();
        expect(after.objectiveCoverageResult, "B's coverage survives").not.toBeNull();
    });

    it('CONTROL: the start boundary still bumps the finalize token — it fences, it does not destroy', () => {
        // The distinction that keeps this bounded. The finalize-token bump stays at the start
        // boundary because it only stops an in-flight formatter or metrics callback from publishing
        // into the new take; it destroys nothing the user can read.
        //
        // The three after-state signals are different in kind: they are the previous take's review.
        // They moved to confirmed admission. If a later change puts any of them back at the boundary,
        // casualty A above fails.
        const c = priv() as unknown as PrivateController & { finalizeSequence: number };
        const before = c.finalizeSequence;

        void priv().startRecording(POLICY as never, []).catch(() => { /* refusal is not the subject */ });

        expect(c.finalizeSequence, 'the fence still advances').toBeGreaterThan(before);
    });
});
