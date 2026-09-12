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
    contentLeaks,
    type PracticeLoopJourneyEvidence,
} from '../live/helpers/practiceLoopJourney';

const SESSION = 'sess-4f2a9c1b';
const MODEL = 'gemini-3.6-flash';

/** A journey that satisfies PO's procedure end to end. Every casualty is this, minus one thing. */
const provenJourney: PracticeLoopJourneyEvidence = {
    savedSessionId: SESSION,
    sessionSaved: true,
    suggestionRequests: 1,
    manualGenerationTriggered: false,
    renderedPhraseCounts: { whatWentWell: 1, whatToImprove: 1 },
    terminalOutcomes: ['rendered_success'],
    modelIdentity: { requested: MODEL, observed: MODEL, persisted: MODEL },
    telemetry: {
        events: [
            'session_saved',
            'practice_loop_review_requested',
            'practice_loop_review_completed',
            'practice_loop_review_persisted',
            'practice_loop_review_rendered',
        ],
        stagesReached: ['practice_loop_ready', 'review_rendered'],
        boundSessionId: SESSION,
        boundModel: MODEL,
    },
};

const without = (patch: Partial<PracticeLoopJourneyEvidence>): PracticeLoopJourneyEvidence =>
    ({ ...provenJourney, ...patch });

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

    it('CASUALTY: telemetry bound to the wrong session', () => {
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, boundSessionId: 'sess-someone-else' },
        }))).toContain('telemetry is bound to a different session than the one saved');
    });

    it('CASUALTY: telemetry bound to the wrong model', () => {
        // Down-selection integrity: a row attributed to the wrong candidate is worse than a missing row.
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, boundModel: 'gemini-3-flash-preview' },
        }))).toContain('telemetry is bound to a different model than the one persisted');
    });

    it('CASUALTY: requested, observed and persisted model identity diverge', () => {
        expect(practiceLoopJourneyFailures(without({
            modelIdentity: { requested: MODEL, observed: MODEL, persisted: 'gemini-3-flash-preview' },
        }))).toContain(`model identity diverges: requested=${MODEL} observed=${MODEL} persisted=gemini-3-flash-preview`);
    });

    it('CASUALTY: the correlated sequence is broken, so the journey cannot be reconstructed', () => {
        // Order matters: a rendered event with no preceding request is not a journey, it is two facts.
        expect(practiceLoopJourneyFailures(without({
            telemetry: { ...provenJourney.telemetry, events: ['practice_loop_review_rendered'] },
        }))).toContain('telemetry is missing practice_loop_review_requested after the preceding step, so the journey cannot be reconstructed');
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
