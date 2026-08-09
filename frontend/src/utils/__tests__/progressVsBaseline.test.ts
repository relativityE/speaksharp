import { describe, it, expect } from 'vitest';
import { computeProgressVsBaseline, MIN_COMPARABLE_SECONDS } from '../progressVsBaseline';

// #1222 §6 — the Progress-vs-baseline data contract (fillers/min, session-1 baseline, ±% delta,
// <30s guard, 6-session trend with baseline pinned leftmost, honest regression).
describe('computeProgressVsBaseline (#1222 §6)', () => {
    it('empty history → no baseline, no delta', () => {
        const r = computeProgressVsBaseline([]);
        expect(r).toMatchObject({ isBaseline: false, currentRate: null, baselineRate: null, deltaPercent: null, trend: [] });
    });

    it('session 1 SETS the baseline and shows NO delta', () => {
        // 6 fillers over 120s = 3.0/min
        const r = computeProgressVsBaseline([{ fillerCount: 6, durationSeconds: 120 }]);
        expect(r.isBaseline).toBe(true);
        expect(r.deltaPercent).toBeNull();
        expect(r.currentRate).toBe(3);
        expect(r.baselineRate).toBe(3);
        expect(r.trend).toEqual([3]);
    });

    it('uses fillers/MINUTE, not raw count — a longer session with the same rate is not worse', () => {
        // baseline 3/min (6/120s); current also 3/min but longer (12/240s) → 0% change, flat.
        const r = computeProgressVsBaseline([
            { fillerCount: 6, durationSeconds: 120 },
            { fillerCount: 12, durationSeconds: 240 },
        ]);
        expect(r.currentRate).toBe(3);
        expect(r.baselineRate).toBe(3);
        expect(r.deltaPercent).toBe(0);
        expect(r.direction).toBe('flat');
    });

    it('improvement = fewer fillers/min → POSITIVE delta ("N% fewer")', () => {
        // baseline 3.4/min (~6.8/120s ≈ use 34/600s), current 2.4/min → +~29%.
        const r = computeProgressVsBaseline([
            { fillerCount: 34, durationSeconds: 600 }, // 3.4/min
            { fillerCount: 24, durationSeconds: 600 }, // 2.4/min
        ]);
        expect(r.baselineRate).toBe(3.4);
        expect(r.currentRate).toBe(2.4);
        expect(r.direction).toBe('improved');
        expect(r.deltaPercent).toBeGreaterThan(0);
        expect(r.deltaPercent).toBeCloseTo(29.4, 0);
    });

    it('regression = more fillers/min → NEGATIVE delta, reported honestly', () => {
        const r = computeProgressVsBaseline([
            { fillerCount: 20, durationSeconds: 600 }, // 2.0/min baseline
            { fillerCount: 30, durationSeconds: 600 }, // 3.0/min current
        ]);
        expect(r.direction).toBe('regressed');
        expect(r.deltaPercent).toBeLessThan(0);
        expect(r.deltaPercent).toBeCloseTo(-50, 0);
    });

    it('current session under the 30s floor → too short to compare, no delta', () => {
        const r = computeProgressVsBaseline([
            { fillerCount: 20, durationSeconds: 600 },
            { fillerCount: 2, durationSeconds: MIN_COMPARABLE_SECONDS - 1 },
        ]);
        expect(r.tooShort).toBe(true);
        expect(r.currentRate).toBeNull();
        expect(r.deltaPercent).toBeNull();
        expect(r.baselineRate).toBe(2); // baseline still reported from the prior comparable session
    });

    it('sub-30s prior sessions do NOT enter the baseline/trend', () => {
        // First (too short) is ignored; the 2nd comparable session becomes the baseline.
        const r = computeProgressVsBaseline([
            { fillerCount: 1, durationSeconds: 10 },     // ignored
            { fillerCount: 30, durationSeconds: 600 },   // baseline 3.0/min
            { fillerCount: 18, durationSeconds: 600 },   // current 1.8/min
        ]);
        expect(r.isBaseline).toBe(false);
        expect(r.baselineRate).toBe(3);
        expect(r.currentRate).toBe(1.8);
        expect(r.direction).toBe('improved');
    });

    it('trend pins the baseline leftmost and caps at 6 columns', () => {
        // 8 comparable sessions → trend = [baseline, ...last 5] = 6 entries, baseline first.
        const sessions = Array.from({ length: 8 }, (_, i) => ({ fillerCount: (i + 1) * 6, durationSeconds: 360 }));
        const r = computeProgressVsBaseline(sessions);
        expect(r.trend).toHaveLength(6);
        expect(r.trend[0]).toBe(1); // session 1: 6/360s = 1.0/min (baseline pinned leftmost)
        // last element is the current (8th) session: 48/360s = 8.0/min
        expect(r.trend[r.trend.length - 1]).toBe(8);
    });
});
