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
import { emitCoverageEvaluation, __resetCoverageTelemetryForTests } from '../coverageTelemetry';
import { ensureJourneyBoundary, __resetJourneyBoundaryForTests } from '@/hooks/useJourneyBoundary';
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
    __resetCoverageTelemetryForTests();
    __resetJourneyBoundaryForTests();
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

    it('CASUALTY: the gate reads what this tab actually DELIVERED', () => {
        // The evaluator had no production caller at all: a requirement captured but never able to fire.
        expect(observedEventFamilies()).toEqual([]);
        expect(currentRunCompleteness().verdict).toBe('HOLD');

        for (const family of REQUIRED_EVENT_FAMILIES) {
            analyticsBuffer.push(family as Parameters<typeof analyticsBuffer.push>[0], {}, 'CRITICAL');
        }
        expect(currentRunCompleteness().verdict).toBe('QUALIFIED');
    });

    it('CASUALTY: a family that was PRODUCED but never delivered does not qualify', () => {
        // This assertion is the inverse of the one it replaces, and the inversion is the correction.
        //
        // The old test asserted that producing was enough, on the argument that the gate asks whether the
        // instrumentation RAN. That is not this gate's question. Its contract is to notice that a required
        // event is ABSENT FROM THE READBACK, and an event recorded at the producer and then evicted by
        // backpressure is absent from the readback while the gate says QUALIFIED — the precise false pass
        // it exists to prevent. Recording at delivery is what makes the verdict answerable.
        analyticsBuffer.ready = false;
        analyticsBuffer.push('session_started', { mode: 'private' }, 'LOW');
        expect(observedEventFamilies()).not.toContain('session_started');
        expect(currentRunCompleteness().verdict).toBe('HOLD');
    });

    it('CASUALTY: an ordinary Private-only run is not held for its Private events', () => {
        // Private acquisition producers push `private_model_acquisition_*`, which are deliberately outside
        // GOVERNED_EVENTS and carry their own allowlist. The gate treats every name outside that
        // vocabulary as unrecognised and forces HOLD — so recording them made a NORMAL, complete Private
        // session unable to qualify. A gate that fails on the product's ordinary path is not fail-closed,
        // it is broken, and the pressure would have been to loosen the gate rather than fix the recorder.
        for (const family of REQUIRED_EVENT_FAMILIES) {
            analyticsBuffer.push(family as Parameters<typeof analyticsBuffer.push>[0], {}, 'CRITICAL');
        }
        analyticsBuffer.push('private_model_acquisition_start' as Parameters<typeof analyticsBuffer.push>[0], {}, 'CRITICAL');

        expect(observedEventFamilies()).not.toContain('private_model_acquisition_start');
        const result = currentRunCompleteness();
        expect({ verdict: result.verdict, unrecognised: result.unrecognised })
            .toEqual({ verdict: 'QUALIFIED', unrecognised: [] });
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



describe('#1421 P1 — an attempt never crosses an account boundary', () => {
    it('CASUALTY: the incoming account\'s FIRST event does not carry the previous account\'s attempt', () => {
        analyticsBuffer.identify('account-A');
        const attemptA = beginRecordingAttempt();
        expect(attemptA).not.toBeNull();

        // B signs in in the same tab. Nothing else closes the attempt: retirement happens where the next
        // take begins, and product exit does not touch it.
        analyticsBuffer.identify('account-B');

        expect(currentAttemptId()).toBeNull();

        // The ordering is the finding, not just the retirement. `account_identified` is emitted DURING
        // identify(), so a retirement that ran afterwards would have cleaned up everything except the one
        // event that carried the confusion.
        const identified = captured('account_identified');
        const inherited = identified.filter((row) => row.attempt_id === attemptA);
        expect({ eventsInheritingAsAttempt: inherited.length }).toEqual({ eventsInheritingAsAttempt: 0 });
    });

    it('CONTROL: re-identifying the SAME account is not a boundary', () => {
        analyticsBuffer.identify('account-A');
        const attempt = beginRecordingAttempt();
        // A token refresh or a revisit. Retiring here would sever a take from its own save — the exact
        // defect the previous fix removed by moving retirement to the next accepted start.
        analyticsBuffer.identify('account-A');
        expect(currentAttemptId()).toBe(attempt);
    });

    it('CONTROL: a FIRST identification after anonymous use is the same person arriving', () => {
        const attempt = beginRecordingAttempt();
        analyticsBuffer.identify('account-A');
        expect(currentAttemptId()).toBe(attempt);
    });
});

describe('#1421 P1 — coverage de-duplication is scoped to the attempt', () => {
    const evaluation = {
        pointsSupplied: 2, pointsEvaluated: 2, coveredThreshold: 0.6, partialThreshold: 0.3,
        transcriptWordCount: 40,
        observations: [
            { position: 1, matchRatio: 0.9, keywordCount: 3, verdict: 'covered' as const, latched: true },
            { position: 2, matchRatio: 0.1, keywordCount: 3, verdict: 'missed' as const, latched: false },
        ],
    };

    /** `coverage_evaluation` is HIGH, so it queues; a CRITICAL push drains the queue synchronously. */
    const flush = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

    it('CASUALTY: a RETRY of the same set with the same result still reports', () => {
        beginRecordingAttempt();
        emitCoverageEvaluation(evaluation);
        flush();
        expect(captured('coverage_evaluation').length).toBe(1);

        // The user retries the same Focus Points set and delivers it much the same way. Nothing in
        // production resets this module between takes, so the identical signature suppressed the second
        // take entirely — losing the ordinary retry that a Focus Points experiment exists to compare.
        endRecordingAttempt();
        beginRecordingAttempt();
        emitCoverageEvaluation(evaluation);
        flush();

        expect({ evaluations: captured('coverage_evaluation').length }).toEqual({ evaluations: 2 });
    });

    it('CONTROL: repeated renders WITHIN one attempt still report once', () => {
        beginRecordingAttempt();
        emitCoverageEvaluation(evaluation);
        emitCoverageEvaluation(evaluation);
        flush();
        // The evaluator runs on render; a per-frame stream is the noise the contract forbids.
        expect({ evaluations: captured('coverage_evaluation').length }).toEqual({ evaluations: 1 });
    });
});

describe('#1421 P1 — the journey boundary is established before the entry event', () => {
    it('CASUALTY: entering a product from outside it begins a journey at the ENTRY, not after it', () => {
        ensureJourneyBoundary('/');
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        const outsideJourney = captured('session_started')[0]?.journey_id;

        // The emitter establishes the boundary itself, immediately before emitting. Previously this was
        // an ancestor effect, and React flushes DESCENDANT passive effects first — so the entry event was
        // captured under the outgoing journey and the new id was minted for everything after it.
        ensureJourneyBoundary('/practice');
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        const entryJourney = captured('session_started')[1]?.journey_id;

        expect({ sameJourney: entryJourney === outsideJourney }).toEqual({ sameJourney: false });
    });

    it('CONTROL: moving BETWEEN product routes stays one journey', () => {
        ensureJourneyBoundary('/practice');
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        const first = captured('session_started')[0]?.journey_id;

        // Session -> Analytics -> session is one visit. Splitting it would hide precisely the
        // post-session navigation these events exist to describe.
        ensureJourneyBoundary('/analytics');
        analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');
        const second = captured('session_started')[1]?.journey_id;

        expect({ sameJourney: second === first }).toEqual({ sameJourney: true });
    });
});
