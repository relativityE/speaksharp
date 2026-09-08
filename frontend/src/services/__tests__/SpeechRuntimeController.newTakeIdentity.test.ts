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

    it('STRUCTURAL: the retirement sits at the producer latch, not at the start boundary', async () => {
        // The positive half needs a service that genuinely reaches confirmed admission, and this
        // harness has no engine — the whole reason the casualty above can rely on the start failing.
        // Setting the store by hand here and calling it proof would be exactly the shape this file's
        // header warns about: it would pass whether or not the controller ever did it.
        //
        // So this asserts the PLACEMENT instead, and says so. The behavioural positive half — B is
        // reviewed with B's id and A is never requested again — is owned by
        // `SessionPage.practiceLoopReview.component.test.tsx` :: the A→B journey.
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('frontend/src/services/SpeechRuntimeController.ts', 'utf8');

        const clear = src.indexOf('useSessionStore.getState().setCompletedSessionId(null);');
        const producerLatch = src.indexOf('controller_producer_latched');
        const coverageClear = src.indexOf('useSessionStore.getState().setObjectiveCoverageResult(null);');

        expect(clear, 'the retirement exists').toBeGreaterThan(-1);
        expect(producerLatch, 'the producer latch exists').toBeGreaterThan(-1);
        expect(clear, 'retirement comes AFTER confirmed admission').toBeGreaterThan(producerLatch);
        // ...and specifically no longer sits with the start-boundary clears, which is where it was.
        expect(clear, 'retirement is no longer at the start boundary').toBeGreaterThan(coverageClear);
    });

    it('CONTROL: the START boundary still clears the signals that do NOT identify a saved take', async () => {
        // `finalizedAnalysis` and the objective coverage rail are settled-UI signals for the take just
        // finished; clearing them the moment the user asks to record again is correct even if that
        // start then fails, because neither is something the user can still read afterwards.
        //
        // `completedSessionId` is different in kind: it is the identity of a SAVED session the review
        // can still read. That is why it moved to confirmed admission and these did not — and this
        // asserts the two groups have genuinely diverged rather than drifted apart by accident.
        useSessionStore.getState().setCompletedSessionId('session-take-one');
        useSessionStore.getState().setObjectiveCoverageResult([
            { label: 'a point', covered: true, coveredAtSec: 1, quote: null },
        ] as never);

        await priv().startRecording(POLICY as never, []).catch(() => { /* as above */ });

        const s = useSessionStore.getState();
        expect({
            finalizedAnalysis: s.finalizedAnalysis,
            objectiveCoverage: s.objectiveCoverageResult,
        }).toEqual({ finalizedAnalysis: null, objectiveCoverage: null });
        expect(s.completedSessionId, 'the saved take survives a failed start').toBe('session-take-one');
    });
});
