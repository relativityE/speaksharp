/**
 * #1532 Codex P1 r4120338743 (PM RETURN 5866867380, repair loop 2) — THE READBACK'S BASE FAMILIES FOLLOW THE DECLARED
 * STAGES. A feedback-only journey (feedback shared after the Analytics reload minted a new journey) never records, so
 * requiring the recording spine of it HOLDs every good run. Recording stages keep the full spine unchanged.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    evaluateTelemetryCompleteness, PRE_JOURNEY_EVENT_FAMILIES, QUALIFICATION_STAGES, REQUIRED_EVENT_FAMILIES,
    requiredFamiliesForStages,
} from '../completenessGate';

const FEEDBACK = QUALIFICATION_STAGES.find((s) => s.stage === 'share_feedback')!.requiredFamilies;
const feedbackJourney = [...PRE_JOURNEY_EVENT_FAMILIES, ...FEEDBACK, 'journey_step'];

describe('requiredFamiliesForStages', () => {
    it('CASUALTY: a complete feedback-only journey HOLDs under the recording spine (the defect) and QUALIFIES under its own stages', () => {
        expect(evaluateTelemetryCompleteness(feedbackJourney).verdict).toBe('HOLD');
        expect(evaluateTelemetryCompleteness(feedbackJourney, requiredFamiliesForStages(['share_feedback'])).verdict).toBe('QUALIFIED');
    });

    it('CONTROL: a feedback-only journey missing feedback_submit still HOLDs', () => {
        const partial = feedbackJourney.filter((f) => f !== 'feedback_submit');
        expect(evaluateTelemetryCompleteness(partial, requiredFamiliesForStages(['share_feedback'])).verdict).toBe('HOLD');
    });

    it('CONTROL: a feedback-only journey still needs the pre-journey identity receipts', () => {
        const noIdentity = feedbackJourney.filter((f) => f !== 'account_identified');
        expect(evaluateTelemetryCompleteness(noIdentity, requiredFamiliesForStages(['share_feedback'])).verdict).toBe('HOLD');
    });

    it('CONTROL: any recording stage keeps the full recording spine, unchanged', () => {
        for (const declared of [['session_during'], ['session_after_open_mic'], ['session_after_focus_points'], ['session_during', 'share_feedback']]) {
            expect([...requiredFamiliesForStages(declared)]).toEqual([...REQUIRED_EVENT_FAMILIES]);
        }
    });

    it('fails closed: an empty or unknown declaration keeps the full spine (the stage loop separately HOLDs unknown names)', () => {
        expect([...requiredFamiliesForStages([])]).toEqual([...REQUIRED_EVENT_FAMILIES]);
        expect([...requiredFamiliesForStages(['share_feedback', 'not_a_stage'])]).toEqual([...REQUIRED_EVENT_FAMILIES]);
    });

    it('the default for every other caller is unchanged', () => {
        expect(evaluateTelemetryCompleteness(feedbackJourney).verdict).toBe('HOLD');
    });

    it('the readback script passes the stage-aware set, not the default', () => {
        const script = readFileSync(resolve(__dirname, '../../../../../scripts/telemetry-readback-qualification.mts'), 'utf8');
        expect(script).toMatch(/evaluateTelemetryCompleteness\(observed, requiredFamiliesForStages\(declared\)\)/);
    });
});
