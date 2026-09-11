import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMAS, isValidForEventField, projectEventProps } from '../../telemetryAllowlist';

/**
 * #1421 Option A — the attribution receipt names the take a verdict settled, as separate governed fields.
 * Content-free: bounded slugs, a positive ordinal and two closed sets. An ungoverned event ships no
 * properties at all, so registration is what lets the readback require this row.
 */
const EVENT = 'model_attribution_receipt';
const RECEIPT = {
    subject_boot_id: 'boot-1',
    subject_journey_id: 'journey-1',
    subject_attempt_id: 'attempt-1',
    subject_attempt_seq: 3,
    attribution_status: 'verified',
    receipt_path: 'retry_full_save',
};

describe('#1421 Option A — model_attribution_receipt is governed and content-free', () => {
    it('is registered, so it ships its properties and completeness recognises it', () => {
        expect(Object.keys(EVENT_SCHEMAS)).toContain(EVENT);
        expect(Object.keys((EVENT_SCHEMAS as Record<string, object>)[EVENT]).sort()).toEqual(Object.keys(RECEIPT).sort());
    });

    it('projects exactly the subject and verdict fields and drops anything else', () => {
        const { props, dropped } = projectEventProps(EVENT, { ...RECEIPT, note: 'extra' });
        expect(props).toEqual(RECEIPT);
        expect(dropped).toContain('note');
    });

    it.each([
        ['subject_attempt_seq', 0],
        ['subject_attempt_seq', 1.5],
        ['subject_attempt_seq', '3'],
        ['subject_attempt_id', 'attempt 1'],
        ['subject_attempt_id', 'a'.repeat(65)],
        ['subject_boot_id', ''],
        ['subject_journey_id', 'journey/1'],
        ['attribution_status', 'pending'],
        ['receipt_path', 'reload'],
    ])('rejects %s = %j', (field, value) => {
        expect(isValidForEventField(EVENT, field, value)).toBe(false);
    });

    it.each(Object.entries(RECEIPT))('accepts a well-formed %s', (field, value) => {
        expect(isValidForEventField(EVENT, field, value)).toBe(true);
    });
});
