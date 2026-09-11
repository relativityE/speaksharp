/**
 * #1421 P1 `3984043475` — a saved take is model-specific evidence only when ONE server-verified receipt
 * names it (PM design `5630363286`, rules 5–7).
 *
 * The receipt's `subject_*` fields name the take whose attestation settled; the row's ambient boot is the
 * boot that emitted it. A take qualifies only when its subject matches exactly, the receipt was emitted by
 * the same boot, the verdict is `verified`, and there is exactly one such receipt. Each casualty below
 * breaks exactly one of those and must HOLD.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    QUALIFICATION_STAGES,
    evaluateQualificationStage,
    savedTakesHaveOneVerifiedReceipt,
    type DecodedTelemetryRow,
} from '../completenessGate';
import { buildReadbackQuery, stageEvidenceRows } from '../bootScopedReceipts';

const BOOT = 'boot-a';
const JOURNEY = 'journey-a';
type Take = { attemptId: string; attemptSeq: number };
const take = (attemptId = 'attempt-1', attemptSeq = 1): Take => ({ attemptId, attemptSeq });

const saved = (t: Take = take(), ambient: Partial<DecodedTelemetryRow> = {}): DecodedTelemetryRow => ({
    event: 'session_saved',
    journeyId: JOURNEY,
    bootId: BOOT,
    properties: { attempt_id: t.attemptId, attempt_seq: t.attemptSeq },
    ...ambient,
});

const receipt = (
    t: Take = take(),
    status = 'verified',
    ambient: Partial<DecodedTelemetryRow> = {},
    subject: Record<string, unknown> = {},
): DecodedTelemetryRow => ({
    event: 'model_attribution_receipt',
    journeyId: JOURNEY,
    bootId: BOOT,
    ...ambient,
    properties: {
        subject_boot_id: BOOT,
        subject_journey_id: JOURNEY,
        subject_attempt_id: t.attemptId,
        subject_attempt_seq: t.attemptSeq,
        attribution_status: status,
        ...subject,
    },
});

describe('#1421 P1 `3984043475` — each saved take needs exactly one verified receipt that names it', () => {
    it('POSITIVE CONTROL: first try, same boot, same journey, verified', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt()])).toBeNull();
    });

    it('POSITIVE CONTROL: a Retry Save receipt emitted under a LATER ambient journey of the same boot still qualifies its own take', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', { journeyId: 'journey-b' })])).toBeNull();
    });

    it('POSITIVE CONTROL: the attempt ordinal compares by value when the transport returns it as a canonical string', () => {
        const stringly = receipt(take(), 'verified', {}, { subject_attempt_seq: '1' });
        expect(savedTakesHaveOneVerifiedReceipt([saved(take(), { properties: { attempt_id: 'attempt-1', attempt_seq: '1' } }), stringly]))
            .toBeNull();
    });

    it('a journey with no saved take leaves the missing save to the family check', () => {
        expect(savedTakesHaveOneVerifiedReceipt([receipt()])).toBeNull();
    });

    it('CASUALTY: a saved take with NO receipt HOLDs', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved()])).toMatch(/no terminal attribution receipt naming it/);
    });

    it('CASUALTY: an UNVERIFIED verdict HOLDs', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'unverified')])).toMatch(/not verified/);
    });

    it('CASUALTY: a CONFLICTING pair (verified and unverified) HOLDs', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(), receipt(take(), 'unverified')])).toMatch(/not verified/);
    });

    it('CASUALTY: a DUPLICATE verified receipt HOLDs', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(), receipt()])).toMatch(/more than one attribution receipt/);
    });

    it('CASUALTY: a reload-recovered receipt (new ambient boot) never qualifies the old take', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', { bootId: 'boot-b' })]))
            .toMatch(/different boot/);
    });

    it('CASUALTY: a receipt with NO ambient boot HOLDs rather than being assumed same-boot', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', { bootId: null })]))
            .toMatch(/different boot/);
    });

    it('CASUALTY: take B cannot qualify on take A\'s receipt', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(take('attempt-2', 2)), receipt(take('attempt-1', 1))]))
            .toMatch(/no terminal attribution receipt naming it/);
    });

    it('CASUALTY: the match is on the SUBJECT, never the receipt\'s ambient attempt', () => {
        // Ambient identity names take 1 (the attempt current at emission); the subject names another take.
        const borrowed = receipt(take('attempt-9', 9), 'verified', {}, {});
        borrowed.properties = { ...borrowed.properties, attempt_id: 'attempt-1', attempt_seq: 1 };
        expect(savedTakesHaveOneVerifiedReceipt([saved(), borrowed])).toMatch(/no terminal attribution receipt naming it/);
    });

    it('CASUALTY: the subject BOOT is part of the match', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', {}, { subject_boot_id: 'boot-z' })]))
            .toMatch(/no terminal attribution receipt naming it/);
    });

    it('CASUALTY: the subject JOURNEY is part of the match', () => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', {}, { subject_journey_id: 'journey-z' })]))
            .toMatch(/no terminal attribution receipt naming it/);
    });

    it.each([
        ['a fractional ordinal', { subject_attempt_seq: 1.5 }],
        ['a zero ordinal', { subject_attempt_seq: 0 }],
        ['a non-canonical string ordinal', { subject_attempt_seq: '01' }],
        ['a prose ordinal', { subject_attempt_seq: 'one' }],
        ['a legacy receipt with no subject attempt', { subject_attempt_id: undefined, subject_attempt_seq: undefined }],
    ])('CASUALTY: %s cannot name the take', (_label, subject) => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(), receipt(take(), 'verified', {}, subject)]))
            .toMatch(/no terminal attribution receipt naming it/);
    });

    it.each([
        ['no attempt id', { properties: { attempt_seq: 1 } }],
        ['no attempt ordinal', { properties: { attempt_id: 'attempt-1' } }],
        ['no boot', { bootId: null }],
        ['no journey', { journeyId: '' }],
    ])('CASUALTY: a saved take with %s cannot be bound and HOLDs', (_label, ambient) => {
        expect(savedTakesHaveOneVerifiedReceipt([saved(take(), ambient as Partial<DecodedTelemetryRow>), receipt()]))
            .toMatch(/no complete boot, journey and attempt identity/);
    });

    it('CASUALTY: EVERY saved take needs its own receipt', () => {
        const t1 = take('attempt-1', 1);
        const t2 = take('attempt-2', 2);
        expect(savedTakesHaveOneVerifiedReceipt([saved(t1), saved(t2), receipt(t1)])).toMatch(/no terminal attribution receipt naming it/);
        expect(savedTakesHaveOneVerifiedReceipt([saved(t1), saved(t2), receipt(t1), receipt(t2)])).toBeNull();
    });

    it('both After profiles enforce it, and nothing else does', () => {
        for (const stage of QUALIFICATION_STAGES) {
            const rows: DecodedTelemetryRow[] = stage.requiredFamilies.map((family) => {
                if (family === 'session_saved') return saved();
                if (family === 'model_attribution_receipt') return receipt(take(), 'unverified');
                if (family === 'feedback_submit') return { event: family, properties: { outcome: 'stored' } };
                return { event: family, properties: {} };
            });
            const reasons = evaluateQualificationStage(stage, rows);
            const binding = `${stage.stage}: a saved take has an attribution receipt that is not verified`;
            if (stage.stage.startsWith('session_after_')) {
                expect(stage.requiredFamilies, `${stage.stage} requires the receipt`).toContain('model_attribution_receipt');
                expect(reasons, `${stage.stage} enforces the binding`).toContain(binding);
            } else {
                expect(reasons, `${stage.stage} does not`).not.toContain(binding);
            }
        }
    });
});

describe('#1421 P1 `3984043475` — the readback reaches the receipt that names this journey', () => {
    const J = 'journey-a';
    const PRE = ['account_identified', 'telemetry_positive_control'];
    const r = (event: string, journeyId: string, properties: Record<string, unknown> = {}) =>
        ({ event, journeyId, bootId: BOOT, timestamp: '2026-09-11T10:00:00Z', properties });

    it('admits a receipt located by its SUBJECT journey even when emitted under another ambient journey', () => {
        const retried = r('model_attribution_receipt', 'journey-b', { subject_journey_id: J });
        expect(stageEvidenceRows([retried], J, PRE)).toEqual([retried]);
    });

    it('keeps the existing scope: this journey\'s rows and the pre-journey receipts', () => {
        const own = r('session_saved', J);
        const pre = r('account_identified', 'pre-product');
        expect(stageEvidenceRows([own, pre], J, PRE)).toEqual([own, pre]);
    });

    it('CASUALTY: another journey\'s ordinary rows, and receipts naming another journey, stay out', () => {
        const foreignRow = r('session_saved', 'journey-b');
        const foreignReceipt = r('model_attribution_receipt', 'journey-b', { subject_journey_id: 'journey-b' });
        const notAReceipt = r('session_saved', 'journey-b', { subject_journey_id: J });
        expect(stageEvidenceRows([foreignRow, foreignReceipt, notAReceipt], J, PRE)).toEqual([]);
    });

    it('the decoder reads each cell from the column the query selects at that position', () => {
        const query = buildReadbackQuery({
            windowHours: 24, releaseSha: 'sha', trafficType: 'canary', qualifyingIdentity: 'person-1',
            governedEvents: ['session_saved'], quote: (v: string) => `'${v}'`,
        });
        const selectList = query.slice(query.indexOf('SELECT') + 'SELECT'.length, query.indexOf('FROM'));
        const columns = selectList.split(',').map((c) => c.trim()).map((c) => /\bAS\s+(\w+)$/.exec(c)?.[1] ?? c);

        const script = readFileSync(resolve(__dirname, '../../../../../scripts/telemetry-readback-qualification.mts'), 'utf8');
        const snake = (name: string) => name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
        const decoded = [...script.matchAll(/(\w+): \(?cells\[(\d+)\]/g)].map((m) => [snake(m[1]), Number(m[2])] as const);

        expect(decoded.length, 'the decoder maps every selected column').toBe(columns.length);
        for (const [name, index] of decoded) {
            expect({ name, selectedAt: columns[index] }).toEqual({ name, selectedAt: name });
        }
        for (const field of ['attempt_id', 'attempt_seq', 'subject_boot_id', 'subject_journey_id',
            'subject_attempt_id', 'subject_attempt_seq', 'attribution_status']) {
            expect(columns, `the readback selects ${field}`).toContain(field);
        }
    });
});
