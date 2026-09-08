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

    it('CASUALTY: starting a new recording clears completedSessionId', async () => {
        // The state after take one saved: an id the review reader would fall back to.
        useSessionStore.getState().setCompletedSessionId('session-take-one');
        useSessionStore.getState().setFinalizedAnalysis(null);
        expect(useSessionStore.getState().completedSessionId).toBe('session-take-one');

        // Take two. The start is expected to fail in this harness — there is no engine — but the
        // supersession happens at the boundary, BEFORE any engine work, which is the point: the previous
        // take's identity must not survive the user pressing record again, whatever happens next.
        await priv().startRecording(POLICY as never, []).catch(() => { /* engine absence is not the subject */ });

        expect({ completedSessionId: useSessionStore.getState().completedSessionId })
            .toEqual({ completedSessionId: null });
    });

    it('CONTROL: it is cleared alongside the signals it belongs with', async () => {
        // `finalizedAnalysis` and the objective coverage rail are cleared at the same boundary for the
        // same reason. If a later change moves one of them, this shows the set has drifted apart.
        useSessionStore.getState().setCompletedSessionId('session-take-one');
        useSessionStore.getState().setObjectiveCoverageResult([
            { label: 'a point', covered: true, coveredAtSec: 1, quote: null },
        ] as never);

        await priv().startRecording(POLICY as never, []).catch(() => { /* as above */ });

        const s = useSessionStore.getState();
        expect({
            completedSessionId: s.completedSessionId,
            finalizedAnalysis: s.finalizedAnalysis,
            objectiveCoverage: s.objectiveCoverageResult,
        }).toEqual({ completedSessionId: null, finalizedAnalysis: null, objectiveCoverage: null });
    });
});
