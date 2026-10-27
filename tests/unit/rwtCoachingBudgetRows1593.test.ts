/**
 * #1593 (Sam 1792317800 §6, decision (a) 1792318646): the Open Mic and shared Focus journeys emit the WHOLE-SCENARIO
 * `coaching request budget` row from the existing request-boundary tap, after a bounded settle of every sent exchange, with
 * the selected maxima 4 (Open Mic) / 7 (full Focus) / 4 (partial Focus). The campaign's budget admission (U + M <= B) then
 * reads an actual count for cases 1–3; an unanswered/unreadable exchange stays HOLD inside the row (rwtCoachingCollector).
 * Case 15 (maintained read-only navigation, maximum 0) emits the same row so its zero is observed, not inferred.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(f, 'utf8');
/** #1593 (Sam, #1662 RETURN): the journey's ONE owned finalization — registration to its report. */
const finalization = (s: string) => {
    const at = s.indexOf('finalizer.once(async () => {');
    return at === -1 ? '' : s.slice(at, s.indexOf('steps.report(receipt);', at));
};
const SETTLE = "await steps.step('coaching settle', () => generations.settle(), FINALIZE_SETTLE_MS);";

describe('#1593 whole-scenario coaching request budget rows (cases 1–3 and 15)', () => {
    it('Open Mic: maximum 4, emitted in the scenario finalization AFTER settling every sent exchange', () => {
        const f = finalization(src('tests/live/rwt-open-mic-first-session.live.spec.ts'));
        const settle = f.indexOf(SETTLE);
        const row = f.indexOf('coachingRequestBudgetRow(receipt, generations, { maximum: 4 })');
        expect(settle).toBeGreaterThan(-1);
        expect(row).toBeGreaterThan(settle);
    });

    it('shared Focus journey: the row uses the suite maximum, after settling, in its finalization', () => {
        const f = finalization(src('tests/live/helpers/rwtFocusPointsJourney.ts'));
        const settle = f.indexOf(SETTLE);
        const row = f.indexOf('coachingRequestBudgetRow(receipt, generations, { maximum: coachingMaximum })');
        expect(settle).toBeGreaterThan(-1);
        expect(row).toBeGreaterThan(settle);
    });

    it('full Focus passes 7 and partial Focus passes 4 — the selected campaign maxima, never a planned-max substitute', () => {
        expect(src('tests/live/rwt-focus-points-session.live.spec.ts')).toContain("'focus-points-session', owner, 7, finalizer);");
        expect(src('tests/live/rwt-focus-points-partial.live.spec.ts')).toContain("'focus-points-partial', owner, 4, finalizer);");
    });

    it('case 15 navigation: the tap is attached before the journey, and maximum 0 is emitted after settling in the finalization', () => {
        const s = src('tests/live/rwt-products-navigation.live.spec.ts');
        const attach = s.indexOf('generations.attach(page);');
        const tryAt = s.indexOf('try {', attach);
        const f = finalization(s);
        const settle = f.indexOf(SETTLE);
        const row = f.indexOf('coachingRequestBudgetRow(receipt, generations, { maximum: 0 })');
        expect(attach).toBeGreaterThan(-1);
        expect(tryAt).toBeGreaterThan(attach);
        expect(settle).toBeGreaterThan(-1);
        expect(row).toBeGreaterThan(settle);
    });
});
