import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    markCompletionStage, resetCompletionChain, reachedStages, COMPLETION_CHAIN,
    __resetCompletionStagesForTests,
} from '../completionStages';
import { projectEventProps } from '../../telemetryAllowlist';
import { beginJourney, __resetJourneyIdentityForTests } from '../journeyIdentity';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const rows = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => c[0] === 'stage_latency').map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetCompletionStagesForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});
afterEach(() => vi.useRealTimers());

describe('F16 — one number becomes seven', () => {
    it("THE LIVE SESSION: 14 seconds after Stop, attributed stage by stage", () => {
        vi.useFakeTimers();
        // These add to roughly the 14 seconds Production shows between the end of recording and the
        // save event — the interval the PO experienced as a ~17-second finalizing banner.
        markCompletionStage('stop_intent');
        vi.advanceTimersByTime(400);
        markCompletionStage('recording_terminated');
        vi.advanceTimersByTime(9_000);
        markCompletionStage('final_transcript');
        vi.advanceTimersByTime(600);
        markCompletionStage('evaluation_complete');
        vi.advanceTimersByTime(3_000);
        markCompletionStage('session_saved');
        vi.advanceTimersByTime(200);
        markCompletionStage('practice_loop_ready');
        vi.advanceTimersByTime(800);
        markCompletionStage('review_rendered');
        drain();

        // Six intervals from seven marks. Nine seconds of decode is a MODEL problem; three seconds of
        // save is a DATABASE problem. One total says only "fourteen seconds" and names no owner.
        expect(rows().map((r) => [r.stage, r.duration_ms])).toEqual([
            ['recording_terminated', 400],
            ['final_transcript', 9_000],
            ['evaluation_complete', 600],
            ['session_saved', 3_000],
            ['practice_loop_ready', 200],
            ['review_rendered', 800],
        ]);
    });

    it('the FIRST mark emits nothing — there is no previous stage to measure from', () => {
        markCompletionStage('stop_intent');
        drain();
        expect(rows()).toHaveLength(0);
    });

    it('A CHAIN THAT STOPS is the finding — the absence names where it got stuck', () => {
        markCompletionStage('stop_intent');
        markCompletionStage('recording_terminated');
        markCompletionStage('final_transcript');
        // Nothing more arrives: the session finalized and never rendered a review.
        drain();
        expect(reachedStages()).toEqual(['stop_intent', 'recording_terminated', 'final_transcript']);
        expect(rows().map((r) => r.stage)).not.toContain('review_rendered');
    });

    it('a stage re-entered does NOT emit a second, flattering interval', () => {
        vi.useFakeTimers();
        markCompletionStage('stop_intent');
        vi.advanceTimersByTime(5_000);
        markCompletionStage('review_rendered');
        vi.advanceTimersByTime(10);
        markCompletionStage('review_rendered');   // a re-render of the review screen
        drain();
        // Without the guard the chain would report a 10ms review and look faster than it was.
        expect(rows()).toHaveLength(1);
        expect(rows()[0].duration_ms).toBe(5_000);
    });

    it('a new take starts a new chain', () => {
        vi.useFakeTimers();
        markCompletionStage('stop_intent');
        vi.advanceTimersByTime(60_000);
        resetCompletionChain();
        markCompletionStage('stop_intent');
        vi.advanceTimersByTime(500);
        markCompletionStage('recording_terminated');
        drain();
        // Without the reset the second take would measure from the first take's Stop.
        expect(rows()).toHaveLength(1);
        expect(rows()[0].duration_ms).toBe(500);
    });

    it('never collapses the chain into a total', () => {
        for (const stage of COMPLETION_CHAIN) markCompletionStage(stage);
        drain();
        // One row per stage, six rows for seven stages, and no aggregate row anywhere.
        expect(rows()).toHaveLength(COMPLETION_CHAIN.length - 1);
        expect(rows().map((r) => r.stage)).not.toContain('total');
    });

    it('every completion stage is accepted by the schema', () => {
        for (const stage of COMPLETION_CHAIN) {
            expect(projectEventProps('stage_latency', { stage, duration_ms: 1 }).dropped).toEqual([]);
        }
        expect(projectEventProps('stage_latency', { stage: 'made_up' }).dropped).toContain('stage');
    });
});
