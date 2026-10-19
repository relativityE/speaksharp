/**
 * #1532 Codex P1 r4120338743 (PM RETURN 5866867380, repair loop 2) — THE READBACK'S BASE FAMILIES FOLLOW THE DECLARED
 * STAGES. A feedback-only journey (feedback shared after the Analytics reload minted a new journey) never records, so
 * requiring the recording spine of it HOLDs every good run. Ordinary recording stages keep the full spine; the
 * deliberately interrupted-repeat exception retains its explicit lifecycle and delivery requirements (#1593).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    evaluateTelemetryCompleteness, PRE_JOURNEY_EVENT_FAMILIES, QUALIFICATION_STAGES, REQUIRED_EVENT_FAMILIES,
    requiredFamiliesForStages, exactlyOnceFamiliesForStages, evaluateQualificationStage, readbackVerdict, type DecodedTelemetryRow,
} from '../completenessGate';
import { evaluateAttemptScopedDelivery } from '../deliveryReceiptGate';

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

describe('#1593 case1 interrupted repeat does not require a completed practice loop', () => {
    const DECLARED = ['session_interrupted_repeat'];
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    const BOOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
    const row = (event: string, at: number, properties: Record<string, unknown> = {}): DecodedTelemetryRow => ({
        event, bootId: BOOT, journeyId: 'repeat-journey', timestamp: 1_800_000_000_000 + at,
        properties: { producer_ts: 1_800_000_000_000 + at, attempt_id: A, attempt_seq: 1, ...properties },
    });
    const lifecycle = (stage: string, at: number, properties: Record<string, unknown> = {}) => row('ai_coaching_lifecycle', at, {
        stage, diagnostic_request_id: REQUEST, origin_attempt_id: A, origin_boot_id: BOOT, ...properties,
    });
    /** Saved A → its own requested R → review Repeat → accepted B → R's observed supersession. No practice_loop. */
    const received = (): DecodedTelemetryRow[] => [
        row('telemetry_positive_control', 0), row('account_identified', 0), row('session_started', 0),
        row('stage_latency', 1, { stage: 'recording_terminated' }), row('stage_latency', 2, { stage: 'final_transcript' }),
        row('session_saved', 3), row('stage_latency', 3, { stage: 'session_saved' }), row('transcript_authority', 3),
        row('model_attribution_receipt', 3, { subject_boot_id: BOOT, subject_journey_id: 'repeat-journey',
            subject_attempt_id: A, subject_attempt_seq: 1, attribution_status: 'verified' }),
        lifecycle('requested', 4), row('journey_step', 9, { step: 'option_selected', option_selected: 'practice_next' }),
        row('recording_intent', 10, { intent_kind: 'start', intent_outcome: 'accepted', attempt_id: B }),
        lifecycle('ended', 11, { end_reason: 'superseded_session' }),
        row('recording_state', 12, { to_state: 'RECORDING', attempt_id: B }), row('session_started', 13, { attempt_id: B }),
    ];
    const judge = (rows: DecodedTelemetryRow[], declared: readonly string[] = DECLARED) => {
        const completeness = evaluateTelemetryCompleteness(rows.map((r) => r.event), requiredFamiliesForStages(declared));
        const delivery = evaluateAttemptScopedDelivery(rows, exactlyOnceFamiliesForStages(declared), [A]);
        const reasons = declared.flatMap((name) => {
            const stage = QUALIFICATION_STAGES.find((s) => s.stage === name);
            return stage ? evaluateQualificationStage(stage, rows, { expectedAttemptIds: [A] }) : [`unknown stage: ${name}`];
        });
        return { completeness, delivery, reasons, verdict: readbackVerdict(reasons, completeness.verdict, delivery.verdict) };
    };

    it('the actual received supersession qualifies through family, stage and attempt-scoped delivery gates', () => {
        const rows = received();
        expect(evaluateTelemetryCompleteness(rows.map((r) => r.event))).toMatchObject({ verdict: 'HOLD', missing: ['practice_loop'] });
        expect(judge(rows)).toMatchObject({ verdict: 'QUALIFIED', completeness: { missing: [] }, delivery: { verdict: 'QUALIFIED' }, reasons: [] });
    });

    it.each([
        ['session_interrupted_repeat'],
        ['session_interrupted_repeat', 'session_during'],
        ['session_during', 'session_interrupted_repeat', 'practice_again'],
        ['session_interrupted_repeat', 'analytics_inventory', 'session_pdf_export', 'share_feedback'],
    ])('only practice_loop leaves the base spine for the known interrupted declaration %j', (...declared) => {
        expect([...requiredFamiliesForStages(declared)]).toEqual(REQUIRED_EVENT_FAMILIES.filter((f) => f !== 'practice_loop'));
        expect(exactlyOnceFamiliesForStages(declared)).toEqual(exactlyOnceFamiliesForStages(['session_during']));
    });

    it('the historical During + interrupted-repeat + Practice-again tuple qualifies only with all three stages proved', () => {
        const declared = ['session_during', 'session_interrupted_repeat', 'practice_again'];
        const identity = { candidate_id: 'private-v2-base', engine: 'private', runtime_version: 'fixture-runtime' };
        const rows = [
            ...received(),
            row('private_model_acquisition_start', -3, { ...identity, expected_candidate_id: 'private-v2-base' }),
            row('private_model_acquisition_success', -2, { ...identity, acquired_candidate_id: 'private-v2-base' }),
            row('transcript_stability', 2), row('mic_observability', 2),
            row('saved_review_practice_action', -2, { action: 'open_session', action_seq: 1, intended_route: 'session', link_state: 'direct' }),
            row('saved_review_practice_arrived', -1, { action_seq: 1, route_class: 'session' }),
        ];
        expect(judge(rows, declared)).toMatchObject({ verdict: 'QUALIFIED', reasons: [], delivery: { verdict: 'QUALIFIED' } });
        expect(judge(rows.filter((r) => r.event !== 'private_model_acquisition_success'), declared).verdict).toBe('HOLD');
        expect(judge(rows.filter((r) => r.event !== 'saved_review_practice_arrived'), declared).verdict).toBe('HOLD');
        const wrongRoute = rows.map((r) => r.event === 'saved_review_practice_arrived'
            ? { ...r, properties: { ...r.properties, route_class: 'other' } } : r);
        expect(judge(wrongRoute, declared).verdict).toBe('FAIL');
    });

    it.each([
        ['session_interrupted_repeat', 'session_after_open_mic'],
        ['session_interrupted_repeat', 'session_after_focus_points'],
        ['session_interrupted_repeat', 'not_a_stage'],
    ])('a full-review or unknown mixed declaration %j keeps the full spine', (...declared) => {
        expect([...requiredFamiliesForStages(declared)]).toEqual([...REQUIRED_EVENT_FAMILIES]);
        expect(judge(received(), declared).verdict).toBe('HOLD');
    });

    it.each(['telemetry_positive_control', 'account_identified', 'recording_intent', 'recording_state', 'session_started', 'session_saved',
        'transcript_authority', 'journey_step', 'stage_latency', 'model_attribution_receipt', 'ai_coaching_lifecycle'])(
        'missing %s still HOLDs', (family) => {
            expect(judge(received().filter((r) => r.event !== family)).verdict).toBe('HOLD');
        },
    );

    it('lost or foreign-origin lifecycle state stays HOLD; a proved render into B stays FAIL', () => {
        const rows = received();
        expect(judge(rows.filter((r) => r.properties?.stage !== 'ended')).verdict).toBe('HOLD');
        expect(judge(rows.map((r) => r.properties?.stage === 'ended'
            ? { ...r, properties: { ...r.properties, origin_boot_id: 'foreign-boot' } } : r)).verdict).toBe('HOLD');
        const stale = judge([...rows, lifecycle('rendered', 15, { attempt_id: B })]);
        expect(stale.verdict).toBe('FAIL');
        expect(stale.reasons.join(' ')).toMatch(/observed stale application into B/);
    });

    it('duplicate or wrong-attempt singleton receipts remain unqualified', () => {
        expect(judge([...received(), row('session_saved', 3)]).delivery.verdict).toBe('HOLD');
        const wrong = received().map((r) => r.event === 'session_saved' ? { ...r, properties: { ...r.properties, attempt_id: B } } : r);
        expect(judge(wrong).delivery.verdict).toBe('HOLD');
    });

    it('unknown/empty declarations and the default retain their strict behavior', () => {
        expect([...requiredFamiliesForStages([])]).toEqual([...REQUIRED_EVENT_FAMILIES]);
        expect(judge(received(), []).verdict).toBe('HOLD');
        expect(evaluateTelemetryCompleteness(received().map((r) => r.event)).verdict).toBe('HOLD');
    });
});
