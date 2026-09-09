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
import { useSessionStore } from '@/stores/useSessionStore';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

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

    it('a REFUSED start touches no successor-owned after-state (weaker than it looks — see note)', async () => {
        /**
         * DISCLOSED: this does NOT prove the stale-admission ordering, and I am not counting it as
         * casualty B.
         *
         * The defect it was written for is real — retirement used to sit ABOVE the
         * `_token.cancelled || _token.version !== this.lifecycleVersion` check, so a start that waited
         * in `startTranscription()`, was superseded, and returned RECORDING late would clear the
         * successor's identity on the way out. The fix moves retirement below that check and re-reads
         * `acceptedAttempt`.
         *
         * But this harness has no engine, so the start never reaches the retirement at all: removing
         * the authority check entirely leaves this test passing. What it actually proves is the
         * narrower claim in its name — a refused start leaves the successor's after-state alone.
         *
         * A discriminating version needs a service that genuinely confirms RECORDING, which is the
         * behavioural admission journey the return asks for and which is not yet built.
         */
        const c = priv() as unknown as PrivateController & {
            acceptedAttempt: unknown;
            lifecycleVersion: number;
            serviceGeneration: number;
        };

        // B owns the after-state.
        const store = useSessionStore.getState();
        store.setCompletedSessionId('session-B');
        store.setFinalizedAnalysis({ sessionId: 'session-B' } as never);
        store.setObjectiveCoverageResult([{ id: 'fp-0', label: 'B point', status: 'covered' }] as never);

        // A's accepted attempt is from an older generation — it lost ownership while suspended.
        c.acceptedAttempt = {
            intentToken: 'stale-intent',
            lifecycleVersion: c.lifecycleVersion - 1,
            recordingId: 'stale-recording',
            serviceGeneration: c.serviceGeneration - 1,
            service: null,
        };

        await priv().startRecording(POLICY as never, []).catch(() => { /* refusal is not the subject */ });

        const after = useSessionStore.getState();
        expect(after.completedSessionId, "B's identity is untouched").toBe('session-B');
        expect(after.finalizedAnalysis, "B's review is untouched").not.toBeNull();
        expect(after.objectiveCoverageResult, "B's coverage is untouched").not.toBeNull();
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
