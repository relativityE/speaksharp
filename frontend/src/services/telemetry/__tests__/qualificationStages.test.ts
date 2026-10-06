/**
 * #1421 P1 — a journey must not QUALIFY while the surfaces under test are absent.
 *
 * `REQUIRED_EVENT_FAMILIES` is the generic session spine, so a readback could return QUALIFIED with
 * every Share Feedback, During and After family missing — telling the reader that a session happened
 * and nothing about whether the things the test exists to diagnose were observable at all.
 *
 * Each casualty below removes exactly one thing and asserts the stage HOLDs for that reason.
 */
import { describe, expect, it } from 'vitest';
import {
    FOCUS_POINTS_POST_STOP_CHAIN,
    OPEN_MIC_POST_STOP_CHAIN,
    QUALIFICATION_STAGES,
    evaluateQualificationStage,
    type DecodedTelemetryRow,
    type QualificationStage,
} from '../completenessGate';

const stageNamed = (name: string): QualificationStage =>
    QUALIFICATION_STAGES.find((s) => s.stage === name)!;

const row = (event: string, properties: Record<string, unknown> = {}): DecodedTelemetryRow =>
    ({ event, properties });

/** The three selectable candidates the down-selection compares. */
const MODELS = ['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'] as const;
let MODEL: string = MODELS[0];

/** A complete, honest journey for one stage: every required family, every invariant satisfied. */
const completeRows = (stage: QualificationStage, model: string = MODELS[0]): DecodedTelemetryRow[] => (
    MODEL = model, stage.requiredFamilies.flatMap((family): DecodedTelemetryRow | DecodedTelemetryRow[] => {
    // #1258 (#1563): a received attempt and ITS outcome (same boot, same submit_seq, outcome after the attempt).
    if (family === 'feedback_submit') return [row(family, { outcome: 'attempted', submit_seq: 1 }), row(family, { outcome: 'storage_ok', submit_seq: 1 })];
    // #1258 (#1563): a received Practice-again press and the SAME press's arrival at its intended route.
    if (family === 'saved_review_practice_action') return [
        row(family, { action: 'open_session', action_seq: 1, intended_route: 'session', link_state: 'direct' }),
        row('saved_review_practice_arrived', { action_seq: 1, route_class: 'session' }),
    ];
    // #1258: the coaching card's own receipt — a validated pair on screen (required for Focus Points).
    // #1538: the envelope's attempt_id binds it to the saved take.
    if (family === 'practice_loop') return row(family, { phase: 'rendered', review_surface: 'coaching_verdict', suggestions_present: true, attempt_id: 'attempt-1' });
    // `to_state` — the property `emitRecordingState()` actually publishes. The fixture said `state`,
    // which is the same defect the production query had: it decoded null on every real row.
    if (family === 'recording_state') {
        return row(family, { to_state: 'RECORDING', candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
    }
    if (family === 'private_model_acquisition_success') {
        return row(family, { acquired_candidate_id: MODEL, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
    }
    if (family === 'private_model_acquisition_start') {
        return row(family, { expected_candidate_id: MODEL, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
    }
    // #1421 P1 `3984043475`: a saved take and the one verified receipt that names it, from the same boot.
    if (family === 'session_saved') {
        return { ...row(family, { attempt_id: 'attempt-1', attempt_seq: 1, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' }),
            journeyId: 'journey-1', bootId: 'boot-1' };
    }
    if (family === 'model_attribution_receipt') {
        return { ...row(family, {
            subject_boot_id: 'boot-1', subject_journey_id: 'journey-1', subject_attempt_id: 'attempt-1',
            subject_attempt_seq: 1, attribution_status: 'verified',
        }), journeyId: 'journey-1', bootId: 'boot-1' };
    }
    // #1421 P1 `3984043479`: the review the user saw, showing the saved transcript and matching it.
    if (family === 'transcript_authority') {
        return row(family, { stage: 'review_rendered', transcript_visibly_present: true, digests_match: true });
    }
    // #1421 P1 `3984043486`: the post-Stop chain that applies to this product, in order.
    if (family === 'stage_latency') {
        const chain = stage.stage === 'session_after_focus_points'
            ? FOCUS_POINTS_POST_STOP_CHAIN
            : OPEN_MIC_POST_STOP_CHAIN;
        // #1421 P1 `3993611256`: the chain belongs to the saved take, so each row carries its attempt —
        // exactly what the envelope attaches in production.
        return chain.map((name, i) => ({ ...row(family, { stage: name, duration_ms: 10, attempt_id: 'attempt-1' }), timestamp: 1_000 + i }));
    }
    return row(family, { candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
}));

describe('#1421 P1 — every UI stage must be evidenced at readback', () => {
    it('POSITIVE CONTROL: a complete journey qualifies every stage', () => {
        // The case that must keep working. A table that refuses everything is not a gate, it is an
        // outage — and every HOLD below is only worth having if the honest path still passes.
        for (const stage of QUALIFICATION_STAGES) {
            expect(evaluateQualificationStage(stage, completeRows(stage)), `${stage.stage} qualifies`)
                .toEqual([]);
        }
    });

    it('CASUALTY (a): omitting ANY required family of ANY stage HOLDs, one family at a time', () => {
        // Not "some family is required" — EACH one is, and a table that silently stopped requiring one
        // would otherwise keep passing on the strength of the others.
        for (const stage of QUALIFICATION_STAGES) {
            for (const family of stage.requiredFamilies) {
                const rows = completeRows(stage).filter((r) => r.event !== family);
                expect(evaluateQualificationStage(stage, rows), `${stage.stage} without ${family}`)
                    .toContain(`${stage.stage}: missing required family ${family}`);
            }
        }
    });

    it('POSITIVE CONTROL: each of the three selectable models qualifies on its own coherent row', () => {
        /**
         * #1421 P1 — the binding must ACCEPT each candidate the down-selection compares, not merely
         * reject mismatches. A rule that holds every model is as useless for a comparison as one that
         * accepts the wrong one.
         */
        const stage = stageNamed('session_during');
        for (const model of MODELS) {
            expect(evaluateQualificationStage(stage, completeRows(stage, model)), `${model} qualifies`)
                .toEqual([]);
        }
    });

    it('CASUALTY: configured != acquired HOLDs', () => {
        /**
         * #1421 P1 — the invariant required ONE non-blank `acquired_candidate_id` and stopped, so a run
         * configured for one model that acquired another satisfied the claimed three-model binding and
         * would have attributed one model's results to another. Requiring a value is not requiring the
         * right value.
         */
        const stage = stageNamed('session_during');
        const rows = completeRows(stage, 'v2:base.en').map((r) => (
            r.event === 'private_model_acquisition_start'
                ? row(r.event, { ...r.properties, expected_candidate_id: 'v4:distil:q4' })
                : r));

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/configured candidate is not the one that was acquired/);
    });

    it('CASUALTY: acquired != running HOLDs', () => {
        // The other half: the loader fetched one model and a different one is what actually ran.
        const stage = stageNamed('session_during');
        const rows = completeRows(stage, 'v2:base.en').map((r) => (
            r.event === 'private_model_acquisition_success'
                ? row(r.event, { ...r.properties, acquired_candidate_id: 'moonshine:streaming-medium' })
                : r));

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/configured candidate is not the one that was acquired|acquired candidate is not the one that ran/);
    });

    it('CASUALTY: an UNIDENTIFIABLE runtime HOLDs', () => {
        // `candidate_id` names the model; `engine` and `runtime_version` are what attribute it to a
        // build. The envelope nulls all three as a set when attribution is unverified, so a candidate
        // named with no engine is the "we cannot say what ran" state.
        const stage = stageNamed('session_during');
        const rows = completeRows(stage, 'v2:base.en').map((r) =>
            row(r.event, { ...r.properties, engine: null, runtime_version: null }));

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/no verified engine or runtime version/);
    });

    it('CASUALTY: MIXED running candidates in one journey HOLDs', () => {
        // Two takes in one row. Averaging them is the contamination the binding exists to refuse.
        const stage = stageNamed('session_during');
        const rows = [
            ...completeRows(stage, 'v2:base.en'),
            row('recording_state', { to_state: 'RECORDING', candidate_id: 'v4:distil:q4', engine: 'private', runtime_version: 'r1' }),
        ];

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/more than one running candidate identity/);
    });

    it('CASUALTY (b): a journey with NO acquired candidate identity HOLDs', () => {
        // The three-model binding. Without an acquired identity the row proves something ran, not WHAT
        // ran, and a down-selection built on it cannot be audited afterwards.
        const stage = stageNamed('session_during');
        const rows = completeRows(stage).map((r) =>
            r.event === 'private_model_acquisition_success' ? row(r.event, {}) : r);

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/no acquired candidate identity/);
    });

    it('CASUALTY (b2): TWO acquired identities in one journey is contamination, not a pass', () => {
        const stage = stageNamed('session_during');
        const rows = [
            ...completeRows(stage),
            row('private_model_acquisition_success', { acquired_candidate_id: 'moonshine:streaming-medium' }),
        ];

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/more than one acquired candidate identity/);
    });

    it('CASUALTY (d): an accepted intent that never reached RECORDING HOLDs', () => {
        // F-01's subject: the click was taken and nothing ran. Every family is present, so only the
        // invariant separates this from a healthy take.
        const stage = stageNamed('session_during');
        const rows = completeRows(stage).map((r) =>
            r.event === 'recording_state' ? row(r.event, { state: 'READY' }) : r);

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/never reached RECORDING/);
    });

    it('CASUALTY (e): a saved session with no transcript authority HOLDs', () => {
        // "Saved count with blank review": the count says it worked and the user sees nothing.
        const stage = stageNamed('session_after_open_mic');
        const rows = completeRows(stage).filter((r) => r.event !== 'transcript_authority');

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/no transcript authority/);
    });

    it('CASUALTY (f): a coverage verdict with no per-point rows HOLDs', () => {
        // A Focus Points headline with nothing behind it — the false-verdict case.
        const stage = stageNamed('session_after_focus_points');
        const rows = completeRows(stage).filter((r) => r.event !== 'coverage_point');

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/no per-point verdicts/);
    });

    it('CASUALTY (g): a feedback submit with no storage outcome HOLDs', () => {
        // Submit attempted is not submit stored. Without the outcome, a failed write reads as a success.
        const stage = stageNamed('share_feedback');
        const rows = completeRows(stage).map((r) =>
            r.event === 'feedback_submit' ? row(r.event, {}) : r);

        expect(evaluateQualificationStage(stage, rows).join(' | '))
            .toMatch(/no storage outcome/);
    });

    it('the acquisition families are REQUIRED, which is what registering them was for', () => {
        // Guards the whole point of the registration change: if these dropped out of the During stage,
        // the readback would go back to qualifying a journey that never proved a model was acquired.
        expect(stageNamed('session_during').requiredFamilies)
            .toEqual(expect.arrayContaining([
                'private_model_acquisition_start',
                'private_model_acquisition_success',
            ]));
    });
});

describe('#1258 (#1563, Codex r4196394184) — RECEIVED outcome correlation: FAIL only when observed, HOLD when missing', () => {
    const at = (event: string, properties: Record<string, unknown>, bootId: string, t: number): DecodedTelemetryRow =>
        ({ event, properties, bootId, timestamp: new Date(Date.UTC(2026, 9, 6, 12, 0, t)).toISOString() });
    const feedback = stageNamed('share_feedback');
    const practice = stageNamed('practice_again');
    const base = (stage: QualificationStage) => completeRows(stage).filter((r) => !['feedback_submit', 'saved_review_practice_action', 'saved_review_practice_arrived'].includes(r.event));
    const reasons = (stage: QualificationStage, rows: DecodedTelemetryRow[]) => evaluateQualificationStage(stage, [...base(stage), ...rows]);

    it('feedback: attempt + its own received outcome qualifies', () => {
        expect(reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1), at('feedback_submit', { outcome: 'storage_ok', submit_seq: 1 }, 'b1', 2)])).toEqual([]);
    });
    it('feedback: a received storage_failed is an OBSERVED failure (FAIL:), with its closed category', () => {
        const r = reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1), at('feedback_submit', { outcome: 'storage_failed', submit_seq: 1, error_category: 'privilege_denied' }, 'b1', 2)]);
        expect(r.join(' ')).toMatch(/share_feedback: FAIL: .*storage_failed \(privilege_denied\)/);
    });
    it('feedback: an attempt with no received outcome is missing evidence (HOLD:), never FAIL', () => {
        const r = reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1)]);
        expect(r.join(' ')).toMatch(/share_feedback: HOLD: 1 feedback attempt/);
        expect(r.join(' ')).not.toMatch(/FAIL:/);
    });
    it('CASUALTY r4196394199: two received attempted(1) and ONE later storage_ok HOLD the first — never qualify both', () => {
        const r = reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1), at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 2), at('feedback_submit', { outcome: 'storage_ok', submit_seq: 1 }, 'b1', 3)]);
        expect(r.join(' ')).toMatch(/HOLD: 1 feedback attempt/);
    });
    it('CASUALTY: an outcome from ANOTHER boot, or one received BEFORE the attempt, does not resolve it', () => {
        expect(reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1), at('feedback_submit', { outcome: 'storage_ok', submit_seq: 1 }, 'b2', 2)]).join(' ')).toMatch(/HOLD:/);
        expect(reasons(feedback, [at('feedback_submit', { outcome: 'storage_ok', submit_seq: 1 }, 'b1', 1), at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 2)]).join(' ')).toMatch(/HOLD:/);
    });
    it('ORDER is by received timestamp, not row order; a mix of timed and untimed rows HOLDs', () => {
        expect(reasons(feedback, [at('feedback_submit', { outcome: 'storage_ok', submit_seq: 1 }, 'b1', 5), at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1)])).toEqual([]);
        expect(reasons(feedback, [at('feedback_submit', { outcome: 'attempted', submit_seq: 1 }, 'b1', 1), { event: 'feedback_submit', properties: { outcome: 'storage_ok', submit_seq: 1 }, bootId: 'b1' }]).join(' ')).toMatch(/no readable timestamp/);
    });
    it('practice: press + its own received arrival at the intended route qualifies', () => {
        expect(reasons(practice, [at('saved_review_practice_action', { action: 'open_session', action_seq: 1, intended_route: 'session', link_state: 'direct' }, 'b1', 1), at('saved_review_practice_arrived', { action_seq: 1, route_class: 'session' }, 'b1', 2)])).toEqual([]);
    });
    it('practice: a wrong route or a failed linked attempt is an OBSERVED failure (FAIL:)', () => {
        expect(reasons(practice, [at('saved_review_practice_action', { action: 'open_session', action_seq: 1, intended_route: 'session' }, 'b1', 1), at('saved_review_practice_arrived', { action_seq: 1, route_class: 'other' }, 'b1', 2)]).join(' ')).toMatch(/practice_again: FAIL: .*intended session, arrived other/);
        expect(reasons(practice, [at('saved_review_practice_action', { action: 'accept_linked', action_seq: 1, intended_route: 'session', link_state: 'linked' }, 'b1', 1), at('saved_review_linked_attempt', { outcome: 'server_failed', action_seq: 1 }, 'b1', 2)]).join(' ')).toMatch(/FAIL: .*linked attempt server_failed/);
    });
    it('practice: a press with no received arrival is missing evidence (HOLD:); a cross-boot arrival never pairs', () => {
        expect(reasons(practice, [at('saved_review_practice_action', { action: 'open_session', action_seq: 1, intended_route: 'session', link_state: 'direct' }, 'b1', 1)]).join(' ')).toMatch(/practice_again: HOLD: 1 Practice-again press/);
        expect(reasons(practice, [at('saved_review_practice_action', { action: 'open_session', action_seq: 1, intended_route: 'session' }, 'b1', 1), at('saved_review_practice_arrived', { action_seq: 1, route_class: 'session' }, 'b2', 2)]).join(' ')).toMatch(/HOLD:/);
    });
    it('a journey that never pressed is not judged on practice_again unless it was declared (no imposed stage)', () => {
        expect(QUALIFICATION_STAGES.find((s) => s.stage === 'practice_again')!.requiredFamilies).toEqual(['saved_review_practice_action']);
    });
});
