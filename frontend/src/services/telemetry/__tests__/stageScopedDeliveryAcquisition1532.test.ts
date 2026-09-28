/**
 * #1532 Codex P1s r4120724715 / r4120724726 (PM RETURN 5870036039) — THE SINGLETON AND FIRST-DOWNLOAD CHECKS FOLLOW THE
 * DECLARED STAGES. The PO's manual v12 order shares feedback (and downloads the Open Mic PDF) AFTER the Analytics reload,
 * which mints a new journey. That journey never starts, saves or acquires anything, so the recording singletons and the
 * first-download receipt must not be demanded of it — while a recording binding keeps both, unchanged.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { declaresRecordingStage, exactlyOnceFamiliesForStages } from '../completenessGate';
import { evaluateDeliveryReceipts, EXACTLY_ONCE_RECEIPT_FAMILIES, type DeliveryReceiptRow } from '../deliveryReceiptGate';

const row = (event: string, properties: Record<string, unknown> = {}): DeliveryReceiptRow => ({ event, properties });
// A complete post-reload feedback journey: its own boot's positive control, identity, and the feedback families.
const feedbackJourneyRows = (): DeliveryReceiptRow[] => [
    row('telemetry_positive_control'), row('account_identified'),
    row('feedback_dialog_opened'), row('feedback_field'), row('feedback_submit', { outcome: 'stored' }),
];

describe('exactlyOnceFamiliesForStages', () => {
    it('CASUALTY: a complete feedback-only journey HOLDs under the recording singletons (the defect) and QUALIFIES under its own', () => {
        expect(evaluateDeliveryReceipts(feedbackJourneyRows()).verdict).toBe('HOLD');
        expect(evaluateDeliveryReceipts(feedbackJourneyRows(), exactlyOnceFamiliesForStages(['share_feedback'])).verdict).toBe('QUALIFIED');
        expect(evaluateDeliveryReceipts(feedbackJourneyRows(), exactlyOnceFamiliesForStages(['share_feedback', 'session_pdf_export'])).verdict)
            .toBe('QUALIFIED');
    });

    it('CONTROL: the post-reload journey still needs its own boot positive control exactly once', () => {
        const scoped = exactlyOnceFamiliesForStages(['share_feedback']);
        expect([...scoped]).toEqual(['telemetry_positive_control']);
        expect(evaluateDeliveryReceipts(feedbackJourneyRows().filter((r) => r.event !== 'telemetry_positive_control'), scoped).verdict).toBe('HOLD');
        expect(evaluateDeliveryReceipts([...feedbackJourneyRows(), row('telemetry_positive_control')], scoped).duplicateFamilies)
            .toEqual(['telemetry_positive_control']);
    });

    it('CONTROL: any recording stage keeps every singleton, unchanged', () => {
        for (const declared of [['session_during'], ['session_after_open_mic', 'analytics_inventory'], ['session_after_focus_points'], ['session_during', 'share_feedback']]) {
            expect([...exactlyOnceFamiliesForStages(declared)]).toEqual([...EXACTLY_ONCE_RECEIPT_FAMILIES]);
        }
    });

    it('fails closed: an empty or unknown declaration keeps every singleton and the recording requirement', () => {
        expect([...exactlyOnceFamiliesForStages([])]).toEqual([...EXACTLY_ONCE_RECEIPT_FAMILIES]);
        expect([...exactlyOnceFamiliesForStages(['share_feedback', 'not_a_stage'])]).toEqual([...EXACTLY_ONCE_RECEIPT_FAMILIES]);
        expect(declaresRecordingStage([])).toBe(true);
        expect(declaresRecordingStage(['not_a_stage'])).toBe(true);
        expect(declaresRecordingStage(['share_feedback', 'session_pdf_export'])).toBe(false);
        expect(declaresRecordingStage(['analytics_inventory', 'session_during'])).toBe(true);
    });
});

describe('the readback script applies both checks per declared stage set', () => {
    const script = readFileSync(resolve(__dirname, '../../../../../scripts/telemetry-readback-qualification.mts'), 'utf8');

    it('delivery singletons use the stage-scoped set, not the default', () => {
        expect(script).toMatch(/evaluateDeliveryReceipts\(deliveryRows, exactlyOnceFamiliesForStages\(declared\)\)/);
        expect(script).not.toMatch(/evaluateDeliveryReceipts\(deliveryRows\)/);
    });

    it('the first-download receipt is required only of a recording binding, and says so when it is not applicable', () => {
        expect(script).toMatch(/const acquisitionRequired = process\.env\.TELEMETRY_READBACK_ACQUISITION_RECEIPT === '1' && declaresRecordingStage\(declared\);/);
        expect(script).toMatch(/if \(acquisitionRequired\) \{\n\s+const acquisitionRows = await runQuery/);
        expect(script).toContain("state: 'NOT_APPLICABLE_NO_RECORDING_STAGE'");
    });
});
