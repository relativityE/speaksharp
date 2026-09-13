/**
 * #1437 — THE JOURNEY VERDICT MUST REFUSE THE FAILURES PO'S PROCEDURE IS LOOKING FOR.
 *
 * The live spec proves the journey happened on canonical Production. It cannot prove the CHECK would
 * have caught a failure, because Production cannot be made to fail on demand. These casualties do that
 * half, in ordinary CI, by driving `practiceLoopJourneyFailures` through each failure shape.
 *
 * This is the pattern #1424 arrived at after eleven Codex findings: observe the real thing, and make
 * the judgement separately falsifiable. A green live run plus a verdict nobody has tested is how
 * "green CI" ends up meaning nothing.
 */
import { describe, expect, it } from 'vitest';
import {
    practiceLoopJourneyFailures,
    routeSurfaceFailures,
    contentLeaks,
    candidateFromPersistedTuple,
    classifyRequestsByBoundary,
    awaitCorrelatedTerminal,
    savedCorrelationsOf,
    observedCandidateAfterSwitch,
    runningCandidateAfterSwitch,
    COMPARISON_TARGETS,
    MODEL_COMPARISON_CDP_ARM_KEY,
    PERSISTED_TUPLE_TO_CANDIDATE,
    type PracticeLoopJourneyEvidence,
} from '../live/helpers/practiceLoopJourney';

const SESSION = 'sess-4f2a9c1b';
const ATTEMPT = 'att-7c1d90e2';
const JOURNEY = 'jrn-1b8e44af';
/** A real comparison candidate id — the thing `private` cannot distinguish. */
const CANDIDATE = 'v2:base.en';
const V2_TUPLE = { engineVersion: 'private_v2:whisper-base.en', modelName: 'whisper-base.en' } as const;
const BOUNDARY_AT = 1_700_000_000_000;

/** A journey that satisfies PO's procedure end to end. Every casualty is this, minus one thing. */
const provenJourney: PracticeLoopJourneyEvidence = {
    savedSessionId: SESSION,
    sessionSaved: true,
    persistenceBoundary: { markerSessionId: SESSION, at: BOUNDARY_AT },
    suggestionRequests: 1,
    suggestionRequestsBeforeSave: 0,
    manualGenerationTriggered: false,
    renderedPhraseCounts: { whatWentWell: 1, whatToImprove: 1 },
    terminalOutcomes: ['rendered_success'],
    terminalFlushSettled: true,
    additionalSavedTakes: 0,
    candidateSwitch: { target: CANDIDATE, outcome: 'ok' },
    observedCandidate: CANDIDATE,
    persistedIdentity: { ...V2_TUPLE, attributionStatus: 'verified' },
    telemetry: {
        events: [
            'session_saved',
            'practice_loop_review_requested',
            'practice_loop_review_completed',
            'practice_loop_review_persisted',
            'practice_loop_review_rendered',
        ],
        stagesReached: ['practice_loop_ready', 'review_rendered'],
        boundCandidateId: CANDIDATE,
        attemptIds: [ATTEMPT],
        journeyIds: [JOURNEY],
    },
};

const without = (patch: Partial<PracticeLoopJourneyEvidence>): PracticeLoopJourneyEvidence =>
    ({ ...provenJourney, ...patch });

const APPROVED_ORIGIN = 'https://speaksharp-public.vercel.app';

describe('#1437 — the pre-credential route surface', () => {
    const realRoute = {
        path: '/auth/signin',
        httpStatus: 200,
        origin: APPROVED_ORIGIN,
        releaseSha: 'a'.repeat(40),
        mockSurfacesPresent: false,
        notFoundRendered: false,
        observedPathname: '/auth/signin',
        routeMarkerVisible: true,
        appVisibleReady: true,
    };

    it('CONTROL: the real route on the approved origin passes', () => {
        expect(routeSurfaceFailures(realRoute, APPROVED_ORIGIN)).toEqual([]);
    });

    it('CASUALTY: a nonexistent route fails immediately, even though the SPA serves its shell with 200', () => {
        // The exact defect. `/auth/login` is not a route; the app answered 200 with its not-found shell,
        // and a check of origin + release + mock surfaces passed on it. Two Production runs were spent
        // before the journey was ever reached.
        // Modelled on what the real 404 did: status 200 (SPA shell), the not-found page rendered, and
        // the sign-in form absent. Both facts are reported, because both are true and each alone is
        // enough to refuse the surface.
        expect(routeSurfaceFailures({
            ...realRoute,
            path: '/auth/login',
            observedPathname: '/auth/login',
            notFoundRendered: true,
            routeMarkerVisible: false,
            // The 404 shell IS committed and visible — that is exactly why it fooled the previous head.
            appVisibleReady: true,
        }, APPROVED_ORIGIN)).toEqual([
            '/auth/login rendered the not-found page; the route does not exist',
            '/auth/login did not render its own content; the surface is blank, loading or errored',
        ]);
    });

    it('CASUALTY: a non-success status and a missing response both fail', () => {
        expect(routeSurfaceFailures({ ...realRoute, httpStatus: 500 }, APPROVED_ORIGIN))
            .toContain('/auth/signin returned HTTP 500');
        expect(routeSurfaceFailures({ ...realRoute, httpStatus: null }, APPROVED_ORIGIN))
            .toContain('/auth/signin returned no response');
    });

    it('CASUALTY (Codex 3997198050): a same-origin redirect to another valid route fails', () => {
        // Every refusal passes here — 200, approved origin, real release, no mocks, not the 404 shell —
        // because the page IS a real page. It is just not the one we asked for. Only comparing the
        // observed pathname catches a rewrite or redirect.
        expect(routeSurfaceFailures({ ...realRoute, observedPathname: '/practice' }, APPROVED_ORIGIN))
            .toEqual(['expected to be on /auth/signin but the browser is on /practice']);
    });

    it('CASUALTY (Codex 3997198050, 2nd pass): the right route with a visible form still fails without app-visible-ready', () => {
        // THE DISCRIMINATING CASE PM ASKED FOR. Correct pathname, correct origin, correct release, no
        // mocks, not the 404 shell, and the sign-in form is visible — every other check passes. Only the
        // repository's centralized authority refuses it. A route-specific selector cannot see this.
        expect(routeSurfaceFailures({ ...realRoute, appVisibleReady: false }, APPROVED_ORIGIN))
            .toEqual(['/auth/signin never reported app-visible-ready; the app has not declared the route committed']);
    });

    it('CASUALTY (Codex 3997198050): a blank, loading or errored shell fails even on the right path', () => {
        // React mounted nothing. The URL is right, the status is right, and the user sees nothing —
        // which every negative check in the previous head accepted.
        expect(routeSurfaceFailures({ ...realRoute, routeMarkerVisible: false }, APPROVED_ORIGIN))
            .toEqual(['/auth/signin did not render its own content; the surface is blank, loading or errored']);
    });

    it('CASUALTY: a wrong origin, a malformed release and mock surfaces each fail', () => {
        expect(routeSurfaceFailures({ ...realRoute, origin: 'https://preview.example.test' }, APPROVED_ORIGIN))
            .toContain('origin https://preview.example.test is not the approved origin');
        expect(routeSurfaceFailures({ ...realRoute, releaseSha: 'not-a-sha' }, APPROVED_ORIGIN))
            .toContain('the deployed release SHA is missing or malformed');
        expect(routeSurfaceFailures({ ...realRoute, mockSurfacesPresent: true }, APPROVED_ORIGIN))
            .toContain('mock surfaces are present on Production');
    });
});

describe('#1437 — the Practice Loop journey verdict', () => {
    it('CONTROL: a journey that satisfies the procedure has no failures', () => {
        expect(practiceLoopJourneyFailures(provenJourney)).toEqual([]);
    });

    it('CASUALTY: automatic generation never starts', () => {
        // PO's original real-world finding. A completed session that never requests coaching is the
        // exact defect, and it must not be reported as a journey.
        expect(practiceLoopJourneyFailures(without({ suggestionRequests: 0, terminalOutcomes: [], renderedPhraseCounts: { whatWentWell: 0, whatToImprove: 0 } })))
            .toContain('no automatic suggestion request was made after the save');
    });

    it('CASUALTY: generation only happens because something triggered it manually', () => {
        // A button, a retry or a refresh producing the review satisfies "a review appeared" while
        // failing the contract, which is automatic-on-save.
        expect(practiceLoopJourneyFailures(without({ manualGenerationTriggered: true })))
            .toContain('generation was triggered manually; the contract is automatic on save');
    });

    it('CASUALTY: the review does not render', () => {
        const failures = practiceLoopJourneyFailures(without({
            renderedPhraseCounts: { whatWentWell: 0, whatToImprove: 0 },
            terminalOutcomes: ['failed_safe'],
            telemetry: { ...provenJourney.telemetry, stagesReached: [] },
        }));
        expect(failures).toContain('the review rendered 0 strength(s) and 0 improvement(s); the contract is exactly one of each');
    });

    it('CASUALTY: a review that did not render still claims the completion stages', () => {
        // #1422's corrected defect, guarded at the journey level: a safe failure must not mark
        // practice_loop_ready or review_rendered.
        const failures = practiceLoopJourneyFailures(without({
            renderedPhraseCounts: { whatWentWell: 0, whatToImprove: 0 },
            terminalOutcomes: ['failed_safe'],
        }));
        expect(failures).toEqual(expect.arrayContaining([
            'practice_loop_ready was marked without a rendered review (outcome: failed_safe)',
            'review_rendered was marked without a rendered review (outcome: failed_safe)',
        ]));
    });

    it('CASUALTY: duplicate terminal outcomes', () => {
        // Two terminal outcomes for one session means the funnel counts a session twice — the class of
        // untruth #1259 exists to prevent.
        expect(practiceLoopJourneyFailures(without({ terminalOutcomes: ['rendered_success', 'failed_safe'] })))
            .toContain('2 terminal outcomes were recorded; exactly one is allowed (rendered_success, failed_safe)');
    });

    it('CASUALTY: more than one provider request for one uncached session', () => {
        expect(practiceLoopJourneyFailures(without({ suggestionRequests: 2 })))
            .toContain('2 suggestion requests were made; exactly one is allowed per uncached session');
    });

    it('CASUALTY: telemetry bound to a different candidate than the one persisted', () => {
        // Down-selection integrity: a row attributed to the wrong candidate is worse than a missing row.
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, boundCandidateId: 'v4:distil:q4' },
        }))).toContain('telemetry is bound to a different candidate than the one persisted');
    });

    it('CASUALTY: two attempts inside one settled take — cross-take contamination', () => {
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, attemptIds: [ATTEMPT, 'att-second'] },
        }))).toContain("2 distinct attempt ids appear on this journey's review events; a settled take has exactly one");
    });

    it('CASUALTY: review events carry no attempt id, so the take cannot be attributed', () => {
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, attemptIds: [] },
        }))).toContain('no attempt id is present on the review events, so the take cannot be attributed');
    });

    it('CASUALTY: the product FACADE is not a candidate identity', () => {
        // `private` agreeing with `private` agreeing with `private` proves nothing about which model ran.
        // This is the shape that would have let all three arms of the down-selection look identical.
        const failures = practiceLoopJourneyFailures(without({
            candidateSwitch: { target: 'private', outcome: 'ok' },
            observedCandidate: 'private',
            persistedIdentity: { engineVersion: 'private', modelName: 'private', attributionStatus: 'verified' },
            telemetry: { ...provenJourney.telemetry, boundCandidateId: 'private' },
        }));
        expect(failures).toEqual(expect.arrayContaining([
            'requested model identity is the product facade "private", not a candidate id',
            'observed model identity is the product facade "private", not a candidate id',
            'persisted model identity is the product facade "private", not a candidate id',
        ]));
    });

    it('CASUALTY: the coaching request fired at or before persistence', () => {
        // A request that beats the save is not the automatic post-save behaviour, even if a review
        // later renders — and the render is exactly what made this shape look fine.
        expect(practiceLoopJourneyFailures(without({ suggestionRequestsBeforeSave: 1 })))
            .toContain('1 coaching request(s) fired at or before persistence; the contract is automatic AFTER a successful save');
    });

    it('CASUALTY: a rendered review that claims neither completion stage', () => {
        // The mirror of the stage casualty below: requiring the stages only in the negative let a
        // success pass having marked nothing.
        const failures = practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, stagesReached: [] },
        }));
        expect(failures).toEqual(expect.arrayContaining([
            'practice_loop_ready was not marked despite a rendered review',
            'review_rendered was not marked despite a rendered review',
        ]));
    });

    it('CASUALTY: requested, observed and persisted model identity diverge', () => {
        // A v4 row under a v2 target — both tuples are known, so this is a divergence, not an unknown.
        expect(practiceLoopJourneyFailures(without({
            persistedIdentity: { engineVersion: 'private_v4:distil_q4', modelName: 'distil_q4', attributionStatus: 'verified' },
        }))).toContain(`model identity diverges: requested=${CANDIDATE} observed=${CANDIDATE} persisted=v4:distil:q4`);
    });

    it('CASUALTY: the correlated sequence is broken, so the journey cannot be reconstructed', () => {
        // Order matters: a save followed by a render, with the request/completed/persisted middle
        // missing, is not a journey — it is two facts that happen to sit next to each other.
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, events: ['session_saved', 'practice_loop_review_rendered'] },
        }))).toContain('telemetry is missing practice_loop_review_requested after the preceding step, so the journey cannot be reconstructed');

        // And a render with no save at all fails at the first step rather than passing silently.
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, events: ['practice_loop_review_rendered'] },
        }))).toContain('telemetry is missing session_saved after the preceding step, so the journey cannot be reconstructed');
    });

    it('CASUALTY: the session never saved', () => {
        expect(practiceLoopJourneyFailures(without({ sessionSaved: false })))
            .toContain('the session did not reach a saved state');
    });

    it('CONTROL: a safe failure with no stage claims and no render is a valid terminal journey', () => {
        // The procedure allows exactly one rendered success OR one safely classified failure. A refused
        // review that claims nothing must not be reported as a defect — otherwise the proof pressures
        // the product into pretending.
        const safeFailure = without({
            renderedPhraseCounts: { whatWentWell: 0, whatToImprove: 0 },
            terminalOutcomes: ['refused_safe'],
            telemetry: { ...provenJourney.telemetry, stagesReached: [] },
        });
        expect(practiceLoopJourneyFailures(safeFailure))
            .toEqual(['the review rendered 0 strength(s) and 0 improvement(s); the contract is exactly one of each']);
    });

    it('CASUALTY: evidence that carries transcript or coaching content is a leak', () => {
        const serialized = JSON.stringify({ ...provenJourney, note: 'Clear opening named the decision.' });
        expect(contentLeaks(serialized, ['Clear opening named the decision.', 'First, we should delay the launch']))
            .toEqual(['Clear opening named the decision.']);
        // The proven evidence shape itself carries nothing to leak.
        expect(contentLeaks(JSON.stringify(provenJourney), ['Clear opening named the decision.'])).toEqual([]);
    });
});

describe('#1437 RETURN workstream 1 — the real save boundary and the real wire boundary', () => {
    it('CONTROL (Codex 3997967382): a request after the real boundary but before the test resumed counts as post-save', () => {
        // THE DISCRIMINATING CASE. The product persisted at BOUNDARY_AT and fired its request 40 ms later;
        // the test only resumed 2 s after that. Classified against the product's own timestamp the request
        // is post-save. Against the previous head's delayed `Date.now()` it was counted as pre-save.
        const requestAt = BOUNDARY_AT + 40;
        const testResumedAt = BOUNDARY_AT + 2_000;
        expect(classifyRequestsByBoundary([requestAt], BOUNDARY_AT)).toEqual({ after: 1, atOrBefore: 0 });
        expect(classifyRequestsByBoundary([requestAt], testResumedAt)).toEqual({ after: 0, atOrBefore: 1 });

        const counts = classifyRequestsByBoundary([requestAt], BOUNDARY_AT);
        expect(practiceLoopJourneyFailures(without({
            suggestionRequests: counts.after,
            suggestionRequestsBeforeSave: counts.atOrBefore,
        }))).toEqual([]);
    });

    it('CASUALTY: a request at or before the real boundary is still refused', () => {
        expect(classifyRequestsByBoundary([BOUNDARY_AT - 5, BOUNDARY_AT], BOUNDARY_AT)).toEqual({ after: 0, atOrBefore: 2 });
    });

    it('CASUALTY: a persistence timestamp that names a different session is refused', () => {
        // `__SS_LAST_PERSISTED_SESSION__` keeps its last value by design; a stale marker from an earlier
        // save must not lend its timestamp to this one.
        expect(practiceLoopJourneyFailures(without({
            persistenceBoundary: { markerSessionId: 'sess-previous', at: BOUNDARY_AT },
        }))).toContain('the persistence timestamp belongs to a different session than the one saved');
    });

    it('CASUALTY: no product timestamp means ordering is unknown, not zero requests', () => {
        const failures = practiceLoopJourneyFailures(without({
            persistenceBoundary: { markerSessionId: SESSION, at: null },
            suggestionRequests: 0,
            suggestionRequestsBeforeSave: 0,
        }));
        expect(failures).toContain('the product published no persistence timestamp, so post-save ordering cannot be established');
        // It is reported as an unknown boundary, never as a product that failed to request.
        expect(failures).not.toContain('no automatic suggestion request was made after the save');
        expect(classifyRequestsByBoundary([BOUNDARY_AT + 40], null)).toEqual({ after: 0, atOrBefore: 0 });
    });

    /** A fake clock whose `sleep` advances time and delivers events scheduled for that moment. */
    type WireEvent = { name: string; attemptId?: string; journeyId?: string };
    const fakeWire = (schedule: Array<{ at: number; event: WireEvent }>) => {
        let clock = 0;
        const delivered: WireEvent[] = [];
        const deliver = () => {
            for (const item of schedule) {
                if (item.at <= clock && !delivered.includes(item.event)) delivered.push(item.event);
            }
        };
        return {
            read: () => { deliver(); return delivered; },
            wait: {
                timeoutMs: 20_000, intervalMs: 500,
                now: () => clock,
                sleep: async (ms: number) => { clock += ms; },
            },
        };
    };

    const saved = { name: 'session_saved', attemptId: ATTEMPT, journeyId: JOURNEY };

    it('CONTROL (Codex 3997967395): a terminal event that flushes 3 s after the DOM turns terminal is observed', async () => {
        const rendered = { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY };
        const wire = fakeWire([{ at: 0, event: saved }, { at: 3_000, event: rendered }]);
        // Counted at the DOM transition — the previous head's behaviour — the outcome is missing.
        expect(wire.read().filter((event) => event.name === rendered.name)).toEqual([]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(true);
        expect(result.events).toEqual([saved, rendered]);
    });

    it('CONTROL (Codex 3998069827): session_saved reaching the wire AFTER the terminal event still settles', async () => {
        // THE DISCRIMINATING CASE. A fast review: the terminal event is on the wire at 1 s, but the batch
        // carrying `session_saved` only flushes at 2.5 s. Resolving the attempt once, before the wait, got null
        // and failed this healthy run; resolving it on every read finds it.
        const rendered = { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY };
        const wire = fakeWire([{ at: 1_000, event: rendered }, { at: 2_500, event: saved }]);
        expect(savedCorrelationsOf(wire.read())).toEqual([]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(true);
    });

    it('CASUALTY: a duplicate terminal event arriving in the next batch is counted, not missed', async () => {
        const first = { name: 'practice_loop_review_failed', attemptId: ATTEMPT, journeyId: JOURNEY };
        const second = { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY };
        const wire = fakeWire([{ at: 0, event: saved }, { at: 1_000, event: first }, { at: 3_500, event: second }]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(true);
        expect(result.events.filter((event) => event.name.startsWith('practice_loop_review_'))).toHaveLength(2);
    });

    it('CASUALTY: a terminal event from a different attempt never settles the wait', async () => {
        const wire = fakeWire([{ at: 0, event: saved }, { at: 1_000, event: { name: 'practice_loop_review_rendered', attemptId: 'att-other', journeyId: JOURNEY } }]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(false);
        expect(practiceLoopJourneyFailures(without({ terminalFlushSettled: false })))
            .toContain('the correlated terminal telemetry was not observed within the bounded wait, so outcomes were counted from an incomplete batch');
    });

    it('CASUALTY: a saved attempt that never reaches the wire is never correlated', async () => {
        // The terminal event arrives, but nothing ever names the attempt — unsettled at the deadline, not a pass.
        const wire = fakeWire([{ at: 1_000, event: { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY } }]);
        expect((await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait)).settled).toBe(false);
    });

    it('CASUALTY (Codex 3998152257): a same-take duplicate arriving well after the first terminal event is still counted', async () => {
        // THE DISCRIMINATING CASE. The first terminal event lands at 1 s; the duplicate at 12 s — far beyond the
        // old 4 s settle window, still inside the 20 s deadline. Returning shortly after the first event dropped
        // it, and exactly-one passed on a take with two outcomes.
        const wire = fakeWire([
            { at: 0, event: saved },
            { at: 1_000, event: { name: 'practice_loop_review_failed', attemptId: ATTEMPT, journeyId: JOURNEY } },
            { at: 12_000, event: { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY } },
        ]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(true);
        expect(result.events.filter((event) => event.name.startsWith('practice_loop_review_'))).toHaveLength(2);
    });

    it('CASUALTY (Codex 3998202205): a later take saved in the window cannot settle the wait for the take under test', async () => {
        // THE DISCRIMINATING CASE. Take A is saved and never emits a terminal event. Take B is saved 2 s later and
        // emits a complete terminal chain. Re-resolving "the latest saved take" on every read switched to B, let
        // B's terminal settle the wait, and the spec re-derived B from the snapshot — pairing A's DOM and persisted
        // row with B's telemetry. A is locked; B is reported as an additional take; nothing settles.
        const takeB = { name: 'session_saved', attemptId: 'att-later', journeyId: JOURNEY };
        const wire = fakeWire([
            { at: 0, event: saved },
            { at: 2_000, event: takeB },
            { at: 3_000, event: { name: 'practice_loop_review_rendered', attemptId: 'att-later', journeyId: JOURNEY } },
        ]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(false);
        expect(result.take).toEqual({ journeyId: JOURNEY, attemptId: ATTEMPT });
        expect(result.additionalSavedTakes).toBe(1);
    });

    it('CONTROL: a single saved take with its own terminal settles and reports no additional take', async () => {
        const wire = fakeWire([
            { at: 0, event: saved },
            { at: 1_000, event: { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY } },
        ]);
        const result = await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait);
        expect(result.settled).toBe(true);
        expect(result.take).toEqual({ journeyId: JOURNEY, attemptId: ATTEMPT });
        expect(result.additionalSavedTakes).toBe(0);
    });

    it('CASUALTY (Codex 3998202205): the verdict refuses evidence whose window held an additional saved take', () => {
        expect(practiceLoopJourneyFailures(without({ additionalSavedTakes: 1 })))
            .toContain('1 additional saved take(s) appeared during the observation window, so its telemetry cannot be attributed to the take under test');
    });

    it('CASUALTY (PM criterion): the same attempt id under a different journey is a different take', async () => {
        const wire = fakeWire([
            { at: 0, event: saved },
            { at: 1_000, event: { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: 'jrn-other' } },
        ]);
        expect((await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait)).settled).toBe(false);
    });

    it('CASUALTY: a saved event without a journey id is never correlated', async () => {
        const wire = fakeWire([
            { at: 0, event: { name: 'session_saved', attemptId: ATTEMPT } },
            { at: 0, event: { name: 'practice_loop_review_rendered', attemptId: ATTEMPT, journeyId: JOURNEY } },
        ]);
        expect((await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait)).settled).toBe(false);
    });

    it('CASUALTY: an absent attempt id on the saved event is never correlated', async () => {
        const wire = fakeWire([{ at: 0, event: { name: 'session_saved' } }, { at: 0, event: { name: 'practice_loop_review_rendered' } }]);
        expect((await awaitCorrelatedTerminal(wire.read, savedCorrelationsOf, wire.wait)).settled).toBe(false);
    });
});

describe('#1437 RETURN workstream 2 — an explicit target and one closed identity mapping', () => {
    it('CONTROL (Codex 3997967390): every comparison candidate maps from the tuple the product persists', () => {
        expect(candidateFromPersistedTuple('private_v2:whisper-base.en', 'whisper-base.en')).toEqual({ candidateId: 'v2:base.en' });
        expect(candidateFromPersistedTuple('private_v4:distil_q4', 'distil_q4')).toEqual({ candidateId: 'v4:distil:q4' });
        expect(candidateFromPersistedTuple('private_moonshine:medium-streaming-en', 'medium-streaming-en'))
            .toEqual({ candidateId: 'moonshine:streaming-medium' });
        // A v4 run that fell back to the default variant maps too, so it reports as a divergence.
        expect(candidateFromPersistedTuple('private_v4:base_q4', 'base_q4')).toEqual({ candidateId: 'v4:base:q4' });
    });

    it('CONTROL: each comparison target passes end to end with its own persisted tuple', () => {
        const tuples: Record<string, { engineVersion: string; modelName: string }> = {
            'v2:base.en': V2_TUPLE,
            'v4:distil:q4': { engineVersion: 'private_v4:distil_q4', modelName: 'distil_q4' },
            'moonshine:streaming-medium': { engineVersion: 'private_moonshine:medium-streaming-en', modelName: 'medium-streaming-en' },
        };
        for (const target of COMPARISON_TARGETS) {
            expect(practiceLoopJourneyFailures(without({
                candidateSwitch: { target, outcome: 'ok' },
                observedCandidate: target,
                persistedIdentity: { ...tuples[target], attributionStatus: 'verified' },
                telemetry: { ...provenJourney.telemetry, boundCandidateId: target },
            }))).toEqual([]);
        }
    });

    it('CASUALTY: direct namespace equality — the previous head — would reject a correct save', () => {
        // The exact defect: `private_v2:whisper-base.en` is never equal to `v2:base.en`.
        expect((V2_TUPLE.engineVersion as string) === CANDIDATE).toBe(false);
    });

    it('CASUALTY: an unknown persisted identity is refused, never guessed', () => {
        expect(candidateFromPersistedTuple('private_v4:distil_q8', 'distil_q8')).toEqual({
            failure: 'persisted engine_version private_v4:distil_q8 is not a known candidate; unknown identities are refused, never guessed',
        });
        expect(practiceLoopJourneyFailures(without({
            persistedIdentity: { engineVersion: 'private_v4:distil_q8', modelName: 'distil_q8', attributionStatus: 'verified' },
        }))).toEqual(expect.arrayContaining([
            'persisted engine_version private_v4:distil_q8 is not a known candidate; unknown identities are refused, never guessed',
            'model identity is incomplete at one of requested/observed/persisted',
        ]));
    });

    it('CASUALTY: an engine_version whose model_name disagrees is refused as inconsistent', () => {
        expect(candidateFromPersistedTuple('private_v2:whisper-base.en', 'distil_q4')).toEqual({
            failure: 'persisted model_name distil_q4 disagrees with engine_version private_v2:whisper-base.en; the tuple is inconsistent',
        });
    });

    it('CASUALTY: an incomplete tuple is refused', () => {
        expect(candidateFromPersistedTuple(null, 'whisper-base.en'))
            .toEqual({ failure: 'the persisted row carries no complete engine_version/model_name tuple' });
    });

    it('CASUALTY (Codex 3997967389): a switch that did not succeed fails the take', () => {
        expect(practiceLoopJourneyFailures(without({ candidateSwitch: { target: CANDIDATE, outcome: 'not_armed' } })))
            .toContain(`the guarded candidate switch to ${CANDIDATE} did not succeed (not_armed)`);
    });

    it('CASUALTY: a target outside the three-model comparison is refused', () => {
        expect(practiceLoopJourneyFailures(without({ candidateSwitch: { target: 'v4:base:int8', outcome: 'ok' } })))
            .toContain('requested target v4:base:int8 is not in the three-model comparison');
    });

    it('CASUALTY (PM criterion): the default acquisition BEFORE the switch cannot lend its identity, even when target == default', () => {
        // THE DISCRIMINATING CASE. The page acquired v2 by default, then the switch bound an acquisition to
        // v2 — but nothing after that bound start published an identity. Reading anywhere in the snapshot would
        // borrow the default's `v2:base.en`, and because the target IS v2 it would even agree.
        const events = [
            { name: 'private_model_acquisition_start' },
            { name: 'private_model_acquisition_success', acquired: 'v2:base.en', candidateId: 'v2:base.en' },
            { name: 'private_model_acquisition_start', expected: 'v2:base.en' },
        ];
        expect(observedCandidateAfterSwitch(events, 'v2:base.en')).toBeNull();
    });

    it('CONTROL: the identity published after the switch-bound acquisition is the observed identity', () => {
        const events = [
            { name: 'private_model_acquisition_start' },
            { name: 'private_model_acquisition_success', acquired: 'v2:base.en' },
            { name: 'private_model_acquisition_start', expected: 'v4:distil:q4' },
            { name: 'private_model_acquisition_success', acquired: 'v4:distil:q4' },
        ];
        expect(observedCandidateAfterSwitch(events, 'v4:distil:q4')).toBe('v4:distil:q4');
        // With no acquired value after the bound start, the envelope's running candidate after it is used.
        expect(observedCandidateAfterSwitch([
            { name: 'private_model_acquisition_start', expected: 'v4:distil:q4' },
            { name: 'session_started', candidateId: 'v4:distil:q4' },
        ], 'v4:distil:q4')).toBe('v4:distil:q4');
    });

    it('CASUALTY (PM 5649623145 item 3): a candidate id emitted BEFORE the switch never becomes the running identity', () => {
        // The default engine published `v2:base.en` before the switch; nothing after the target-bound start
        // carries a candidate id. Searching the whole snapshot would bind the take to the default.
        const beforeSwitchOnly = [
            { name: 'session_started', candidateId: 'v2:base.en' },
            { name: 'private_model_acquisition_start', expected: 'v4:distil:q4' },
        ];
        expect(runningCandidateAfterSwitch(beforeSwitchOnly, 'v4:distil:q4')).toBeNull();
        // Including when the target IS the default, where equality would otherwise mask the borrow.
        expect(runningCandidateAfterSwitch([
            { name: 'session_started', candidateId: 'v2:base.en' },
            { name: 'private_model_acquisition_start', expected: 'v2:base.en' },
        ], 'v2:base.en')).toBeNull();
        // CONTROL: a candidate id published after the bound start is the running identity.
        expect(runningCandidateAfterSwitch([
            ...beforeSwitchOnly,
            { name: 'session_started', candidateId: 'v4:distil:q4' },
        ], 'v4:distil:q4')).toBe('v4:distil:q4');
    });

    it('CASUALTY: no acquisition bound to the target means no observed identity at all', () => {
        expect(observedCandidateAfterSwitch([
            { name: 'private_model_acquisition_start' },
            { name: 'private_model_acquisition_success', acquired: 'v2:base.en' },
        ], 'v2:base.en')).toBeNull();
    });

    it('CASUALTY (Codex 3998152255): agreement without a post-switch running binding is refused', () => {
        // THE DISCRIMINATING CASE. Target, acquired identity and verified persisted identity all agree on v2 —
        // but nothing after the switch carried `candidate_id`, so there is no evidence of what actually ran.
        // The previous verdict compared the running binding only when present, and passed this take.
        const failures = practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, boundCandidateId: null },
        }));
        expect(failures).toContain('no post-switch running identity was observed, so the take cannot be bound to the candidate that ran');
    });

    it('CASUALTY: no acquisition bound to the target leaves observed identity incomplete', () => {
        expect(practiceLoopJourneyFailures(without({ observedCandidate: null })))
            .toContain('model identity is incomplete at one of requested/observed/persisted');
    });

    it('DRIFT GUARD: the restated slate, arm key and mapping still match the product constants', async () => {
        // Imported dynamically so a product-module load problem fails THIS test, visibly, rather than the file.
        const { buildEngineVersion } = await import('@/services/transcription/privateTelemetry');
        const { CANDIDATES } = await import('@/services/transcription/candidateRegistry');
        const { PRIV_STT_V4_VARIANTS } = await import('@/services/transcription/sttConstants');
        const { COMPARISON_CANDIDATE_IDS, MODEL_COMPARISON_CDP_ARM_KEY: productArmKey } =
            await import('@/services/transcription/runtimeCandidateSwitch');

        expect([...COMPARISON_TARGETS]).toEqual([...COMPARISON_CANDIDATE_IDS]);
        expect(MODEL_COMPARISON_CDP_ARM_KEY).toBe(productArmKey);

        const candidates = CANDIDATES as unknown as Record<string, { model: { id: string } }>;
        const v4Variants = PRIV_STT_V4_VARIANTS as unknown as Record<string, { MODEL_ID: string }>;
        for (const [engineVersion, mapping] of Object.entries(PERSISTED_TUPLE_TO_CANDIDATE)) {
            // The key IS what the product writes for this variant and model — no hand-typed drift.
            expect(buildEngineVersion(mapping.variant as Parameters<typeof buildEngineVersion>[0], mapping.modelName)).toBe(engineVersion);
            expect(candidates[mapping.candidateId], `${mapping.candidateId} must be a registered candidate`).toBeDefined();
        }
        // The model half of each engine family matches the registry. Non-empty first, so a guard over an
        // accidentally emptied family cannot pass vacuously.
        const mappings = Object.values(PERSISTED_TUPLE_TO_CANDIDATE);
        const v4Mappings = mappings.filter((mapping) => mapping.variant === 'private_v4');
        const moonshineMappings = mappings.filter((mapping) => mapping.variant === 'private_moonshine');
        expect(v4Mappings.length).toBeGreaterThan(0);
        expect(moonshineMappings.length).toBeGreaterThan(0);
        for (const mapping of v4Mappings) {
            expect(v4Variants[mapping.modelName]?.MODEL_ID).toBe(candidates[mapping.candidateId].model.id);
        }
        for (const mapping of moonshineMappings) {
            expect(candidates[mapping.candidateId].model.id).toBe(mapping.modelName);
        }
        // Every target on the slate is reachable from a persisted tuple.
        const mapped = new Set(Object.values(PERSISTED_TUPLE_TO_CANDIDATE).map((mapping) => mapping.candidateId));
        for (const target of COMPARISON_TARGETS) expect(mapped.has(target), `${target} must be mapped`).toBe(true);
    });
});

describe('#1437 RETURN workstream 3 — persisted identity is trusted only once attribution is verified', () => {
    it('CASUALTY (Codex 3997967394): a pending row cannot satisfy requested = observed = persisted', () => {
        // THE DISCRIMINATING CASE. Target, observed and the persisted tuple all agree on v2 — the tuple is
        // exactly right — but the trusted attestation never confirmed it. The previous head accepted this.
        const failures = practiceLoopJourneyFailures(without({
            persistedIdentity: { ...V2_TUPLE, attributionStatus: 'pending' },
        }));
        expect(failures).toEqual(expect.arrayContaining([
            'persisted attribution is pending, not verified; an unverified row cannot prove which model ran',
            'model identity is incomplete at one of requested/observed/persisted',
        ]));
        expect(failures).not.toContain(`model identity diverges: requested=${CANDIDATE} observed=${CANDIDATE} persisted=${CANDIDATE}`);
    });

    it('CASUALTY: unverified, legacy and absent attribution are all refused', () => {
        for (const attributionStatus of ['unverified', 'legacy_unknown', null]) {
            expect(practiceLoopJourneyFailures(without({ persistedIdentity: { ...V2_TUPLE, attributionStatus } })))
                .toContain(`persisted attribution is ${attributionStatus ?? 'absent'}, not verified; an unverified row cannot prove which model ran`);
        }
    });

    it('CONTROL: the same tuple with verified attribution passes', () => {
        expect(practiceLoopJourneyFailures(without({ persistedIdentity: { ...V2_TUPLE, attributionStatus: 'verified' } }))).toEqual([]);
    });
});
