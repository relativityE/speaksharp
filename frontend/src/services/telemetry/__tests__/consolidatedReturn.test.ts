import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyticsBuffer, observedEventFamilies, __resetObservedEventFamiliesForTests } from '../../AnalyticsBuffer';
import { emitPracticeLoop, __resetPracticeLoopTelemetryForTests } from '../practiceLoopTelemetry';
import {
    beginRecordingAttempt, endRecordingAttempt, currentAttemptId, currentAttemptSeq,
    beginJourney, __resetJourneyIdentityForTests,
} from '../journeyIdentity';
import {
    evaluateTelemetryCompleteness, currentRunCompleteness, REQUIRED_EVENT_FAMILIES,
} from '../completenessGate';
import { emitRetentionObservation } from '../retentionObservation';
import { projectEventProps } from '../../telemetryAllowlist';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyIdentityForTests();
    __resetPracticeLoopTelemetryForTests();
    __resetObservedEventFamiliesForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});

/** The real capture calls, read the way every other suite here reads them. */
const captured = (name: string): Record<string, unknown>[] =>
    (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter((c) => c[0] === name)
        .map((c) => c[1] as Record<string, unknown>);

const review = {
    phase: 'rendered' as const, whatWentWellCount: 1, whatToImproveCount: 1,
    suggestionsPresent: true, whatWentWellSource: 'generated' as const,
    whatToImproveSource: 'generated' as const, rendered: true,
    nextActionPersisted: true, suppressionReason: 'none' as const,
};

describe('#1421 P2 — the rendered review still has an attempt to belong to', () => {
    it('CASUALTY: PRODUCTION ORDERING — the review renders after Stop and still reports', () => {
        // The previous test emitted while its own manually opened attempt was still active, so it could
        // not see the defect. In production `useSessionLifecycle` retired the attempt at stop, and the
        // review renders AFTER that — so `currentAttemptId()` was null and two successive reviews with
        // identical properties shared the signature `[null, props]`, suppressing the second entirely.
        const takeOne = () => {
            endRecordingAttempt();          // retire the previous take, as the accepted start now does
            beginRecordingAttempt();        // this take opens
            // ...recording, stop, save... the attempt is NOT closed at stop any more.
            emitPracticeLoop(review);       // the review renders after Stop, under this take's id
        };

        takeOne();
        expect(currentAttemptId()).not.toBeNull();
        const first = currentAttemptId();

        takeOne();
        expect(currentAttemptId()).not.toBe(first);
        expect(currentAttemptSeq()).toBe(2);

        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        expect(captured('practice_loop')).toHaveLength(2);
    });

    it('CASUALTY: a take stopped under the minimum cannot lend its id to the retry', () => {
        // The short-session branch returns after `stopRecording()` without saving, and the controller goes
        // back to READY, which closes nothing. If the next start reused the open attempt, two distinct
        // accepted takes would appear as one.
        endRecordingAttempt(); beginRecordingAttempt();
        const shortTake = currentAttemptId();
        const shortSeq = currentAttemptSeq();

        // The user immediately tries again.
        endRecordingAttempt(); beginRecordingAttempt();
        expect(currentAttemptId()).not.toBe(shortTake);
        expect(currentAttemptSeq()).toBe(shortSeq + 1);
    });
});

describe('#1421 P1 — the completeness gate is wired and demands what a session must produce', () => {
    it('CASUALTY: stage_latency is required — a readback that lost every latency row must HOLD', () => {
        expect(REQUIRED_EVENT_FAMILIES).toContain('stage_latency');
        const withoutLatency = REQUIRED_EVENT_FAMILIES.filter((f) => f !== 'stage_latency');
        const result = evaluateTelemetryCompleteness([...withoutLatency]);
        expect(result.verdict).toBe('HOLD');
        expect(result.missing).toEqual(['stage_latency']);
    });

    it('CASUALTY: the gate reads what this tab ACTUALLY emitted, not an assumption', () => {
        // The evaluator had no production caller at all: a requirement captured but never able to fire.
        expect(observedEventFamilies()).toEqual([]);
        expect(currentRunCompleteness().verdict).toBe('HOLD');

        for (const family of REQUIRED_EVENT_FAMILIES) {
            analyticsBuffer.push(family as Parameters<typeof analyticsBuffer.push>[0], {}, 'LOW');
        }
        expect(currentRunCompleteness().verdict).toBe('QUALIFIED');
    });

    it('an emitted family is recorded even if the transport later drops it', () => {
        // The gate asks whether the instrumentation RAN. Delivery is a different question with a different
        // answer, and conflating them would let a transport outage read as a producer that never fired.
        analyticsBuffer.ready = false;
        analyticsBuffer.push('session_started', { mode: 'private' }, 'LOW');
        expect(observedEventFamilies()).toContain('session_started');
    });
});

describe('#1421 P2 — an unobserved history is null, never zero', () => {
    it('CASUALTY: null history count survives the schema and is not coerced to 0', () => {
        const { props, dropped } = projectEventProps('retention_observation', {
            policy_version: 'v1', copy_version: 'v1',
            transcript_bearing_before: null, transcript_bearing_after: null,
            expired_count: null, content_free_history_count: null, saved_transcript_state: null,
        });
        expect(dropped).toEqual([]);
        expect(props.content_free_history_count ?? null).toBeNull();
    });

    it('emitting an unobserved cache reports null, so "we did not look" never reads as "nothing there"', () => {
        emitRetentionObservation({
            transcriptBearingBefore: null, transcriptBearingAfter: null,
            contentFreeHistoryCount: null, savedTranscriptState: null,
        });
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        const row = captured('retention_observation')[0];
        expect(row?.content_free_history_count ?? null).toBeNull();
        expect(row?.expired_count ?? null).toBeNull();
    });
});

