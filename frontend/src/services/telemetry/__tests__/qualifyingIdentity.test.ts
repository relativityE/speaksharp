/**
 * #1421 P2 — a row the readback cannot parse is a REFUSAL, not something to drop.
 *
 * The defect was a `.filter()` that removed malformed entries and a cardinality check that then
 * counted only the survivors. One valid identity beside one unreadable row read as "exactly one
 * identity", so the case most likely to mean a second person was the case that qualified silently.
 */
import { describe, it, expect } from 'vitest';
import { resolveQualifyingIdentity } from '../qualifyingIdentity';

describe('#1421 — the qualifying identity is resolved from rows that ALL read cleanly', () => {
    it('CONTROL: one well-formed identity qualifies', () => {
        expect(resolveQualifyingIdentity([['user-a']])).toEqual({ ok: true, distinctId: 'user-a' });
        expect(resolveQualifyingIdentity(['user-a'])).toEqual({ ok: true, distinctId: 'user-a' });
    });

    it('CONTROL: the same identity repeated is still one identity', () => {
        expect(resolveQualifyingIdentity([['user-a'], ['user-a']]))
            .toEqual({ ok: true, distinctId: 'user-a' });
    });

    it.each([
        ['null', [['user-a'], [null]]],
        ['an empty string', [['user-a'], ['']]],
        ['a number', [['user-a'], [42]]],
        ['an object', [['user-a'], [{ distinct_id: 'user-b' }]]],
        ['undefined', [['user-a'], [undefined]]],
        ['an empty row', [['user-a'], []]],
    ])('CASUALTY: one valid identity plus a row that is %s HOLDS', (_label, rows) => {
        // Under the filtered implementation every one of these qualified `user-a`, because the row that
        // could not be read was removed before anything counted.
        // Asserted as a whole object rather than a boolean followed by a conditional narrowing: the
        // refusal REASON is the part that matters, and a conditional expect can silently assert nothing.
        expect(resolveQualifyingIdentity(rows as unknown[]), 'an unreadable row must not be filtered away')
            .toEqual({ ok: false, reason: expect.stringContaining('cannot be ruled out as a second identity') });
    });

    it('CASUALTY: a malformed row HOLDS even when it is the only row', () => {
        expect(resolveQualifyingIdentity([[null]]))
            .toEqual({ ok: false, reason: expect.stringContaining('cannot parse') });
    });

    it('no rows at all HOLDS — there is no identity to bind receipts to', () => {
        expect(resolveQualifyingIdentity([]))
            .toEqual({ ok: false, reason: expect.stringContaining('no events for this release') });
    });

    it('two genuine identities HOLD — a journey belongs to exactly one person', () => {
        expect(resolveQualifyingIdentity([['user-a'], ['user-b']]))
            .toEqual({ ok: false, reason: expect.stringContaining('spans 2 distinct identities') });
    });
});
