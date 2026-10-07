// @vitest-environment node
/**
 * #1258 (#1570, Codex P1 r4201644107; CLI PM option 1a, 6029321428) — a blind "sent" HOLD is settled by RECEIVED evidence.
 *
 * Blob beacons hide their bodies on every page-hide flush, so the tap HOLDs a sent row whose event may have left inside
 * one. Before this change `applyReadback` touched only `journey telemetry received`, so a QUALIFIED readback could never
 * resolve those HOLDs and every such run finalized INCOMPLETE while the row text claimed "the received readback decides".
 * Now a row that names its receiving qualification stages becomes PASS when every bound journey declaring them qualified;
 * coaching outcome and request-cardinality rows name `coaching_readback` and settle only from the separate received coaching
 * verdict (PM delivery #308) — which HOLDs while the producer gap stands, and FAILs the rows on a received conflict.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COACHING_READBACK_STAGE, finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';
import { readbackSettlement, sentDetail } from '../live/helpers/rwtJourney';
import { QUALIFICATION_STAGES } from '../../frontend/src/services/telemetry/completenessGate';
import { PRACTICE_LOOP_RECEIPT_FAMILIES } from '../../frontend/src/services/telemetry/receivedPracticeLoopGate';

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
    evidence: { blindBeacons: 1, ...readbackSettlement(receivedBy, tapAt(200), 100) },
});
const humanRow = (id: string): ReceiptRow => ({
    step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
    evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
});

function receiptWith(overrides: ReceiptRow[], recProduct = false) {
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
        readback: {
            journeys: [{ journeyId: REC, stages: REC_STAGES, ...(recProduct ? { attemptIds: ['att-1'], product: 'open_mic' as const } : {}) }, { journeyId: PDF, stages: PDF_STAGES }],
            reportedJourneyIds: [], missingBindings: [],
        },
    };
}
const readback = (rec: string, pdf: string, coaching?: string) => ({
    suite: SUITE, release: SHA, missingBindings: [],
    journeys: [{ journeyId: REC, stages: REC_STAGES, verdict: rec, ...(coaching ? { coaching } : {}) }, { journeyId: PDF, stages: PDF_STAGES, verdict: pdf }],
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

    it('a stage no bound journey declared cannot settle the row', () => {
        const receipt = receiptWith([blindHold('telemetry sent', ['session_after_open_mic', 'practice_again'])]);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
        expect(finalRow(out, 'telemetry sent').verdict).toBe('HOLD');
    });

    const COACHING = [
        blindHold('coaching telemetry sent', ['coaching_readback']),
        blindHold('revisit is not a generation', ['coaching_readback']),
    ];

    it('PM #308: a QUALIFIED journey with a coaching HOLD (the standing producer gap) leaves only the coaching rows HOLD', () => {
        const receipt = receiptWith([...COVERED, ...COACHING], true);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED', 'HOLD'));
        expect(out.errors).toEqual([]);
        expect(finalRow(out, 'telemetry sent').verdict).toBe('PASS');
        expect(finalRow(out, 'inventory events sent').verdict).toBe('PASS');
        expect(finalRow(out, 'coaching telemetry sent').verdict).toBe('HOLD');
        expect(finalRow(out, 'revisit is not a generation').verdict).toBe('HOLD');
        expect(finalRow(out, 'journey telemetry received').verdict).toBe('PASS');
        expect(out.finalAcceptance).toBe('INCOMPLETE');
    });

    it('a journey QUALIFIED readback alone never settles a coaching row; only a QUALIFIED coaching verdict does', () => {
        const receipt = receiptWith([...COVERED, ...COACHING], true);
        const settled = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED', 'QUALIFIED'));
        expect(finalRow(settled, 'coaching telemetry sent')).toMatchObject({ verdict: 'PASS', evidence: { settledByReadback: true } });
        expect(finalRow(settled, 'revisit is not a generation')).toMatchObject({ verdict: 'PASS', evidence: { settledByReadback: true } });
        expect(settled.finalAcceptance).toBe('PASS');
        const journeyHeld = finalizeReceipt(receipt, worksheetFor(receipt), readback('HOLD', 'QUALIFIED', 'QUALIFIED'));
        expect(finalRow(journeyHeld, 'coaching telemetry sent').verdict).toBe('HOLD');
    });

    it('CASUALTY: a received coaching conflict FAILs the coaching rows, even a row the browser saw as PASS', () => {
        const sentPass: ReceiptRow = { step: 'revisit is not a generation', verdict: 'PASS', detail: 'one generated review', evidence: readbackSettlement(['coaching_readback'], tapAt(), 100) };
        const receipt = receiptWith([...COVERED, COACHING[0], sentPass], true);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED', 'FAIL'));
        expect(finalRow(out, 'coaching telemetry sent').verdict).toBe('FAIL');
        expect(finalRow(out, 'revisit is not a generation')).toMatchObject({ verdict: 'FAIL', evidence: { settledByReadback: true } });
        expect(finalRow(out, 'telemetry sent').verdict).toBe('PASS');
        expect(out.finalAcceptance).toBe('FAIL');
    });

    it('fail closed: a coaching verdict must bind to exactly the receipt\'s saved-take journeys, with a known value', () => {
        const withProduct = receiptWith([...COVERED, ...COACHING], true);
        expect(finalizeReceipt(withProduct, worksheetFor(withProduct), readback('QUALIFIED', 'QUALIFIED')).errors.join(' ')).toMatch(/coaching verdict for exactly/);
        const noProduct = receiptWith([...COVERED, ...COACHING]);
        expect(finalizeReceipt(noProduct, worksheetFor(noProduct), readback('QUALIFIED', 'QUALIFIED', 'QUALIFIED')).errors.join(' ')).toMatch(/coaching verdict for exactly/);
        expect(finalizeReceipt(withProduct, worksheetFor(withProduct), readback('QUALIFIED', 'QUALIFIED', 'MAYBE')).errors.join(' ')).toMatch(/unknown coaching verdict/);
        const out = finalizeReceipt(noProduct, worksheetFor(noProduct), readback('QUALIFIED', 'QUALIFIED'));
        expect(finalRow(out, 'coaching telemetry sent').verdict).toBe('HOLD');
    });

    it('only a BLIND HOLD is eligible: a FAIL, a PASS, or a HOLD with no blind beacon after the step is never rewritten', () => {
        const notBlind: ReceiptRow = { ...blindHold('telemetry sent', ['session_after_open_mic']), evidence: { receivedByStages: 'session_after_open_mic', blindSinceStep: 0 } };
        const failed: ReceiptRow = { step: 'inventory events sent', verdict: 'FAIL', detail: 'absent', evidence: { receivedByStages: 'analytics_inventory', blindSinceStep: 2 } };
        const receipt = receiptWith([notBlind, failed]);
        const out = finalizeReceipt(receipt, worksheetFor(receipt), readback('QUALIFIED', 'QUALIFIED'));
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

describe('SOURCE CONTRACT: each settling row names stages that really receive its events', () => {
    const familiesOf = (stages: readonly string[]) => new Set(stages.flatMap((s) => QUALIFICATION_STAGES.find((q) => q.stage === s)!.requiredFamilies as readonly string[]));
    const CLAIMS: { file: string; constant: string; stages: string[]; events: string[] }[] = [
        { file: '../live/rwt-open-mic-first-session.live.spec.ts', constant: 'telemetryReceivedBy', stages: ['session_after_open_mic', 'share_feedback'], events: ['session_saved', 'feedback_submit'] },
        { file: '../live/rwt-open-mic-first-session.live.spec.ts', constant: 'inventoryReceivedBy', stages: ['analytics_inventory', 'session_pdf_export'], events: ['products_menu_opened', 'saved_review_revisited', 'session_pdf_downloaded'] },
        { file: '../live/helpers/rwtFocusPointsJourney.ts', constant: 'coverageReceivedBy', stages: ['session_after_focus_points'], events: ['coverage_evaluation'] },
        { file: '../live/helpers/rwtFocusPointsJourney.ts', constant: 'focusInventoryReceivedBy', stages: ['analytics_inventory'], events: ['products_menu_opened', 'saved_review_revisited'] },
    ];
    it.each(CLAIMS)('$constant: the declared stages require every event the row counts', ({ file, constant, stages, events }) => {
        const source = readFileSync(path.resolve(__dirname, file), 'utf8');
        expect(source).toContain(`const ${constant} = [${stages.map((s) => `'${s}'`).join(', ')}] as const;`);
        const received = familiesOf(stages);
        expect(events.filter((e) => !received.has(e))).toEqual([]);
    });
    it.each([
        { file: '../live/rwt-open-mic-first-session.live.spec.ts' }, { file: '../live/helpers/rwtFocusPointsJourney.ts' },
    ])('coaching and generation-count rows in $file name only the coaching readback, whose gate judges every event they count', ({ file }) => {
        const source = readFileSync(path.resolve(__dirname, file), 'utf8');
        expect(source).toContain(`const coachingReceivedBy = ['${COACHING_READBACK_STAGE}'] as const;`);
        expect(source).toContain(`const generationReceivedBy = ['${COACHING_READBACK_STAGE}'] as const;`);
        expect(QUALIFICATION_STAGES.some((q) => q.stage === COACHING_READBACK_STAGE)).toBe(false);
        expect([...PRACTICE_LOOP_RECEIPT_FAMILIES]).toEqual(['practice_loop_review_requested', 'practice_loop_review_completed', 'practice_loop_review_persisted', 'practice_loop_review_rendered']);
    });
    it('no live receipt text still claims "the received readback decides" for a HOLD', () => {
        for (const file of ['../live/rwt-open-mic-first-session.live.spec.ts', '../live/helpers/rwtFocusPointsJourney.ts']) {
            expect(readFileSync(path.resolve(__dirname, file), 'utf8')).not.toMatch(/the received readback decides/);
        }
    });
});
