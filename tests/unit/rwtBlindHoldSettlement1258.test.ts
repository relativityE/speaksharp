// @vitest-environment node
/**
 * #1258 (#1570, Codex P1 r4201644107; CLI PM option 1a, 6029321428) — a blind "sent" HOLD is settled by RECEIVED evidence.
 *
 * Blob beacons hide their bodies on every page-hide flush, so the tap HOLDs a sent row whose event may have left inside
 * one. Before this change `applyReadback` touched only `journey telemetry received`, so a QUALIFIED readback could never
 * resolve those HOLDs and every such run finalized INCOMPLETE while the row text claimed "the received readback decides".
 * Now a row that names its receiving qualification stages becomes PASS when every bound journey declaring them qualified;
 * rows no stage receives (coaching outcomes, the exact generation count) stay HOLD and say so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BLIND_HOLD_SETTLEMENT, finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';
import { readbackSettlement, sentDetail } from '../live/helpers/rwtJourney';
import { QUALIFICATION_STAGES } from '../../frontend/src/services/telemetry/completenessGate';

const SUITE = 'open-mic-first-session';
const SHA = 'c'.repeat(40);
const REC = 'journey-rec';
const PDF = 'journey-pdf';
const REC_STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory'];
const PDF_STAGES = ['session_pdf_export'];
const tapAt = (...blindAt: number[]) => ({ blindAt });

const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const blindHold = (step: string, receivedBy: readonly string[]): ReceiptRow => ({
    step, verdict: 'HOLD', detail: sentDetail(`${step} left the page`, false, tapAt(200), 100, receivedBy),
    evidence: { blindBeacons: 1, ...(receivedBy.length > 0 ? readbackSettlement(receivedBy, tapAt(200), 100) : { }) },
});
const humanRow = (id: string): ReceiptRow => ({
    step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
    evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
});

function receiptWith(overrides: ReceiptRow[]) {
    const base: ReceiptRow[] = [
        { step: 'journey telemetry received', verdict: 'HOLD', detail: 'pending' },
        { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'report-only' },
        { step: 'base_q4 primary', verdict: 'HOLD', detail: 'sequenced after RWT' },
        humanRow('open_mic_coaching_relevant'), humanRow('open_mic_uh_detected'),
        ...overrides,
    ];
    const product = requiredAutomatedRows(SUITE)!.product.filter((step) => !base.some((r) => r.step === step)).map(pass);
    const rows = [...base, ...product];
    for (const step of ['telemetry decodable', 'signup-stage telemetry (user class)', 'journey telemetry (canary class)', 'receipt content-free']) {
        if (!rows.some((r) => r.step === step)) rows.push(pass(step));
    }
    return {
        suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: REC, stages: REC_STAGES }, { journeyId: PDF, stages: PDF_STAGES }], reportedJourneyIds: [], missingBindings: [] },
    };
}
const readback = (rec: string, pdf: string) => ({
    suite: SUITE, release: SHA, missingBindings: [],
    journeys: [{ journeyId: REC, stages: REC_STAGES, verdict: rec }, { journeyId: PDF, stages: PDF_STAGES, verdict: pdf }],
});
const worksheetFor = (receipt: ReturnType<typeof receiptWith>) => {
    const md = humanWorksheet(SUITE, SHA, [REC, PDF], receipt.rows);
    return parseHumanWorksheet(md.split('\n').map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-10-07 |') : l)).join('\n'));
};
const finalRow = (out: ReturnType<typeof finalizeReceipt>, step: string) => out.rows.find((r) => r.step === step)!;

const COVERED = [
    blindHold('telemetry sent', ['session_after_open_mic', 'share_feedback']),
    blindHold('inventory events sent', ['analytics_inventory', 'session_pdf_export']),
];

describe('a QUALIFIED readback settles a blind sent HOLD (Codex r4201644107)', () => {
    it('CASUALTY: blind-HOLD sent rows named to qualifying stages finalize PASS, and so does the run', () => {
        const receipt = receiptWith(COVERED);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
        expect(out.errors).toEqual([]);
        expect(finalRow(out, 'telemetry sent')).toMatchObject({ verdict: 'PASS', evidence: { settledByReadback: true } });
        expect(finalRow(out, 'inventory events sent')).toMatchObject({ verdict: 'PASS', evidence: { settledByReadback: true } });
        expect(out.finalAcceptance).toBe('PASS');
    });

    it('a row stays HOLD when ANY journey declaring one of its stages did not qualify (here: the PDF journey)', () => {
        const receipt = receiptWith(COVERED);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'HOLD'));
        expect(finalRow(out, 'telemetry sent').verdict).toBe('PASS');
        expect(finalRow(out, 'inventory events sent')).toMatchObject({ verdict: 'HOLD' });
        expect(out.finalAcceptance).toBe('INCOMPLETE');
    });

    it('an observed received FAIL never settles the row to PASS', () => {
        const receipt = receiptWith(COVERED);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('FAIL', 'QUALIFIED'));
        expect(finalRow(out, 'telemetry sent').verdict).toBe('HOLD');
        expect(out.finalAcceptance).toBe('FAIL');
    });

    it('a mapped stage no bound journey declared cannot settle the row', () => {
        const receipt = receiptWith(COVERED);
        receipt.readback.journeys = [{ journeyId: REC, stages: REC_STAGES.filter((s) => s !== 'share_feedback') }, { journeyId: PDF, stages: PDF_STAGES }];
        const rb = readback('QUALIFIED', 'QUALIFIED');
        rb.journeys[0].stages = receipt.readback.journeys[0].stages;
        const out = finalizeReceipt(receipt, worksheetFor(receipt), rb);
        expect(out.errors).toEqual([]);
        expect(finalRow(out, 'telemetry sent').verdict).toBe('HOLD');
        expect(finalRow(out, 'inventory events sent').verdict).toBe('PASS');
    });

    it('uncovered rows (coaching outcomes, the exact generation count) stay HOLD under a fully qualified readback', () => {
        const receipt = receiptWith([...COVERED, blindHold('coaching telemetry sent', []), blindHold('revisit is not a generation', [])]);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
        expect(finalRow(out, 'coaching telemetry sent').verdict).toBe('HOLD');
        expect(finalRow(out, 'coaching telemetry sent').detail).toMatch(/no readback stage receives these events, so this row stays HOLD$/);
        expect(finalRow(out, 'revisit is not a generation').verdict).toBe('HOLD');
        expect(out.finalAcceptance).toBe('INCOMPLETE');
    });

    it('only a BLIND HOLD is eligible: a FAIL, a PASS, or a HOLD with no blind beacon after the step is never rewritten', () => {
        const notBlind: ReceiptRow = { ...blindHold('telemetry sent', []), evidence: { receivedByStages: 'session_after_open_mic,share_feedback', blindSinceStep: 0 } };
        const failed: ReceiptRow = { step: 'inventory events sent', verdict: 'FAIL', detail: 'absent', evidence: { receivedByStages: 'analytics_inventory,session_pdf_export', blindSinceStep: 2 } };
        const receipt = receiptWith([notBlind, failed]);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
        expect(out.errors).toEqual([]);
        expect(finalRow(out, 'telemetry sent').verdict).toBe('HOLD');
        expect(finalRow(out, 'inventory events sent').verdict).toBe('FAIL');
    });

    it('without a readback nothing is settled', () => {
        const receipt = receiptWith(COVERED);
        const out = finalizeReceipt(receipt, worksheetFor(receipt));
        expect(finalRow(out, 'telemetry sent').verdict).toBe('HOLD');
        expect(out.finalAcceptance).toBe('INCOMPLETE');
    });
});

describe('the finalizer owns a CLOSED row-to-stage map; the receipt never chooses settlement stages (Codex P1 r4214120116)', () => {
    const forged = (step: string, stages: string): ReceiptRow => ({
        step, verdict: 'HOLD', detail: 'forged settlement claim', evidence: { receivedByStages: stages, blindSinceStep: 3 },
    });
    // Finalized under a fully QUALIFIED readback; a rejection is a binding error, INCOMPLETE, with the row never PASS.
    const outcome = (rows: ReceiptRow[], step: string, message: RegExp) => {
        const receipt = receiptWith(rows);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
        return { status: out.status, acceptance: out.finalAcceptance, named: out.errors.some((e) => message.test(e)), settled: out.rows.find((r) => r.step === step)?.verdict === 'PASS' };
    };
    const REJECTED = { status: 'binding_error', acceptance: 'INCOMPLETE', named: true, settled: false };

    it('CASUALTY: an unrelated feedback-retention HOLD cannot settle from session_after_open_mic', () => {
        expect(outcome([...COVERED, forged('feedback retention', 'session_after_open_mic')], 'feedback retention',
            /row "feedback retention" claims readback settlement, which the open-mic-first-session suite never maps/)).toEqual(REJECTED);
    });

    it('a mapped row naming stages other than its mapped set is a binding error (subset, superset, reorder, foreign)', () => {
        for (const stages of ['session_after_open_mic', 'session_after_open_mic,share_feedback,analytics_inventory', 'share_feedback,session_after_open_mic', 'analytics_inventory']) {
            expect(outcome([forged('telemetry sent', stages), COVERED[1]], 'telemetry sent', /row "telemetry sent" names settlement stages other than the mapped session_after_open_mic, share_feedback/)).toEqual(REJECTED);
        }
    });

    it('a malformed blindSinceStep on a mapped row is a binding error', () => {
        const bad: ReceiptRow = { ...COVERED[0], evidence: { ...COVERED[0].evidence, blindSinceStep: '2' } };
        expect(outcome([bad, COVERED[1]], 'telemetry sent', /names settlement stages other than the mapped/)).toEqual(REJECTED);
    });

    it('the map is per suite: an Open Mic mapping does not admit the same stages under a Focus suite', () => {
        expect(BLIND_HOLD_SETTLEMENT['focus-points-session']['inventory events sent']).toEqual(['analytics_inventory']);
        expect(BLIND_HOLD_SETTLEMENT['returning-user-navigation']).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(BLIND_HOLD_SETTLEMENT['open-mic-first-session'], 'feedback retention')).toBe(false);
    });
});

describe('SOURCE CONTRACT: each settling row names stages that really receive its events', () => {
    const familiesOf = (stages: readonly string[]) => new Set(stages.flatMap((s) => QUALIFICATION_STAGES.find((q) => q.stage === s)!.requiredFamilies as readonly string[]));
    const OPEN_MIC = ['open-mic-first-session'];
    const FOCUS = ['focus-points-session', 'focus-points-partial'];
    const CLAIMS: { file: string; constant: string; suites: string[]; step: string; stages: string[]; events: string[] }[] = [
        { file: '../live/rwt-open-mic-first-session.live.spec.ts', constant: 'telemetryReceivedBy', suites: OPEN_MIC, step: 'telemetry sent', stages: ['session_after_open_mic', 'share_feedback'], events: ['session_saved', 'feedback_submit'] },
        { file: '../live/rwt-open-mic-first-session.live.spec.ts', constant: 'inventoryReceivedBy', suites: OPEN_MIC, step: 'inventory events sent', stages: ['analytics_inventory', 'session_pdf_export'], events: ['products_menu_opened', 'saved_review_revisited', 'session_pdf_downloaded'] },
        { file: '../live/helpers/rwtFocusPointsJourney.ts', constant: 'coverageReceivedBy', suites: FOCUS, step: 'coverage_evaluation sent', stages: ['session_after_focus_points'], events: ['coverage_evaluation'] },
        { file: '../live/helpers/rwtFocusPointsJourney.ts', constant: 'focusInventoryReceivedBy', suites: FOCUS, step: 'inventory events sent', stages: ['analytics_inventory'], events: ['products_menu_opened', 'saved_review_revisited'] },
    ];
    it('every closed-map entry is a live claim, and every live claim is in the map for each suite that writes it', () => {
        const mapped = Object.entries(BLIND_HOLD_SETTLEMENT).flatMap(([suite, rows]) => Object.entries(rows).map(([step, stages]) => `${suite}|${step}|${stages.join(',')}`)).sort();
        const claimed = CLAIMS.flatMap((c) => c.suites.map((suite) => `${suite}|${c.step}|${c.stages.join(',')}`)).sort();
        expect(mapped).toEqual(claimed);
    });
    it.each(CLAIMS)('$constant: the declared stages require every event the row counts', ({ file, constant, stages, events }) => {
        const source = readFileSync(path.resolve(__dirname, file), 'utf8');
        expect(source).toContain(`const ${constant} = [${stages.map((s) => `'${s}'`).join(', ')}] as const;`);
        const received = familiesOf(stages);
        expect(events.filter((e) => !received.has(e))).toEqual([]);
    });
    it('no live receipt text still claims "the received readback decides" for a HOLD', () => {
        for (const file of ['../live/rwt-open-mic-first-session.live.spec.ts', '../live/helpers/rwtFocusPointsJourney.ts']) {
            expect(readFileSync(path.resolve(__dirname, file), 'utf8')).not.toMatch(/the received readback decides/);
        }
    });
});
