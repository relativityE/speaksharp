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
    QUALIFICATION_STAGES,
    evaluateQualificationStage,
    type DecodedTelemetryRow,
    type QualificationStage,
} from '../completenessGate';

const stageNamed = (name: string): QualificationStage =>
    QUALIFICATION_STAGES.find((s) => s.stage === name)!;

const row = (event: string, properties: Record<string, unknown> = {}): DecodedTelemetryRow =>
    ({ event, properties });

/** A complete, honest journey for one stage: every required family, every invariant satisfied. */
const completeRows = (stage: QualificationStage): DecodedTelemetryRow[] => stage.requiredFamilies.map((family) => {
    if (family === 'feedback_submit') return row(family, { outcome: 'stored' });
    if (family === 'recording_state') return row(family, { state: 'RECORDING' });
    if (family === 'private_model_acquisition_success') return row(family, { acquired_candidate_id: 'v2:base.en' });
    return row(family);
});

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
