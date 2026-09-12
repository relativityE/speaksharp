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
    type PracticeLoopJourneyEvidence,
} from '../live/helpers/practiceLoopJourney';

const SESSION = 'sess-4f2a9c1b';
const ATTEMPT = 'att-7c1d90e2';
const JOURNEY = 'jrn-1b8e44af';
/** A down-selection candidate id — the thing `private` cannot distinguish. */
const CANDIDATE = 'whisper-base-q4-webgpu';

/** A journey that satisfies PO's procedure end to end. Every casualty is this, minus one thing. */
const provenJourney: PracticeLoopJourneyEvidence = {
    savedSessionId: SESSION,
    sessionSaved: true,
    suggestionRequests: 1,
    suggestionRequestsBeforeSave: 0,
    manualGenerationTriggered: false,
    renderedPhraseCounts: { whatWentWell: 1, whatToImprove: 1 },
    terminalOutcomes: ['rendered_success'],
    // CANDIDATE ids, not the `private` facade: v2/v4/Moonshine is what the down-selection attributes.
    modelIdentity: { requested: CANDIDATE, observed: CANDIDATE, persisted: CANDIDATE },
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
            telemetry: { ...provenJourney.telemetry, boundCandidateId: 'whisper-tiny-en' },
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
            modelIdentity: { requested: 'private', observed: 'private', persisted: 'private' },
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
        expect(practiceLoopJourneyFailures(without({
            modelIdentity: { requested: CANDIDATE, observed: CANDIDATE, persisted: 'whisper-tiny-en' },
        }))).toContain(`model identity diverges: requested=${CANDIDATE} observed=${CANDIDATE} persisted=whisper-tiny-en`);
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
