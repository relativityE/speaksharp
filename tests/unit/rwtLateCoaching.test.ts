// @vitest-environment node
/**
 * PO Option 1, item 2 (2026-11-10): the interrupted take's late coaching is saved to its own session and shown by its saved
 * review. Offline controls for the row: PASS only with a complete saved pair that the saved review shows exactly.
 */
import { describe, expect, it } from 'vitest';
import { LATE_COACHING_ROW, lateCoachingSavedRow, type LateCoachingDeps } from '../live/helpers/rwtLateCoaching';

const PAIR = { what_worked: 'You kept a steady pace.', what_to_try_next: 'Pause before the key point.' };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sink = () => {
    const rows: { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }[] = [];
    const forbidden: string[] = [];
    return { rows, forbidden, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, detail, evidence }); }, forbid: (...v: string[]) => { forbidden.push(...v); } };
};
/** A fake clock: each sleep advances time; `savedAfter` reads return absent before the pair appears. */
const deps = (o: { savedAfter?: number; saved?: unknown; shown?: typeof PAIR | null; readFails?: boolean; reviewThrows?: boolean } = {}): LateCoachingDeps & { reads: () => number } => {
    let t = 0, reads = 0;
    return {
        reads: () => reads,
        now: () => t,
        sleep: async (ms) => { t += ms; },
        readSaved: async () => { reads += 1; if (o.readFails) return { ok: false }; return { ok: true, value: t >= (o.savedAfter ?? 0) ? (o.saved === undefined ? PAIR : o.saved) : null }; },
        openSavedReview: async () => { if (o.reviewThrows) throw new Error('page closed'); return o.shown === undefined ? PAIR : o.shown; },
        same,
    };
};
const verdictOf = async (d: LateCoachingDeps, known = true, opts = { waitMs: 10_000, pollMs: 1_000 }) => {
    const s = sink();
    await lateCoachingSavedRow(s, known, d, opts);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].step).toBe(LATE_COACHING_ROW);
    return { ...s.rows[0], forbidden: s.forbidden };
};

describe('interrupted take coaching saved and shown in its saved review', () => {
    it('PASS: the pair arrives late (after polling), is saved to the take, and its saved review shows exactly it', async () => {
        const d = deps({ savedAfter: 4_000 });
        const r = await verdictOf(d);
        expect(r.verdict).toBe('PASS');
        expect(d.reads()).toBe(5);
        expect(r.evidence).toEqual({ reason: 'saved-and-shown', savedAfterMs: 4_000 });
        expect(r.forbidden).toEqual(expect.arrayContaining([PAIR.what_worked, PAIR.what_to_try_next]));
        expect(JSON.stringify(r.evidence)).not.toContain('steady');
    });
    it('CASUALTY: never saved within the bound is FAIL (late coaching lost), not HOLD', async () => {
        const r = await verdictOf(deps({ savedAfter: 60_000 }));
        expect(r.verdict).toBe('FAIL');
        expect(r.evidence?.reason).toBe('not-saved');
    });
    it('CASUALTY: a malformed saved value FAILs at once', async () => {
        expect((await verdictOf(deps({ saved: { what_worked: '', what_to_try_next: 'x' } }))).verdict).toBe('FAIL');
    });
    it('CASUALTY: saved but the saved review shows nothing, or a different pair, FAILs', async () => {
        expect((await verdictOf(deps({ shown: null }))).evidence?.reason).toBe('not-shown');
        const other = await verdictOf(deps({ shown: { ...PAIR, what_to_try_next: 'Something else entirely.' } }));
        expect(other.verdict).toBe('FAIL');
        expect(other.evidence?.reason).toBe('shown-differs');
    });
    it('an unreadable row, an unopenable review or an unknown session HOLDs — never PASS, never a false FAIL', async () => {
        expect((await verdictOf(deps({ readFails: true }))).verdict).toBe('HOLD');
        expect((await verdictOf({ ...deps(), readSaved: async () => { throw new Error('network'); } })).verdict).toBe('HOLD');
        expect((await verdictOf(deps({ reviewThrows: true }))).verdict).toBe('HOLD');
        expect((await verdictOf(deps(), false)).verdict).toBe('HOLD');
    });
});
