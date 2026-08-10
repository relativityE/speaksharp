import { describe, it, expect } from 'vitest';
import { computePaceStats, paceNudgeWarranted, paceNudgeMessage, fmtDuration } from '../focusPace';

// #1046 G6/G7 §2 — pace is per-point (the dial) with the projection as its consequence; never a countdown.
describe('computePaceStats (#1046 §2)', () => {
    it('running average = elapsed / points covered; projection = average × total', () => {
        // 2 covered in 2:30 → 1:15/point; ×3 points → 3:45 projection; guide 1:00/point → 3:00 total.
        const s = computePaceStats({ elapsedSec: 150, coveredCount: 2, totalPoints: 3, guideSecPerPoint: 60 });
        expect(s.pacePerPointSec).toBe(75);
        expect(s.guideTotalSec).toBe(180);
        expect(s.projectionSec).toBe(225);
        expect(s.overGuide).toBe(true);
        expect(fmtDuration(s.pacePerPointSec!)).toBe('1:15');
        expect(fmtDuration(s.projectionSec!)).toBe('3:45');
        expect(fmtDuration(s.guideTotalSec!)).toBe('3:00');
    });

    it('before the first point is covered: no average, no projection, no bar — never divides by zero', () => {
        const s = computePaceStats({ elapsedSec: 40, coveredCount: 0, totalPoints: 3, guideSecPerPoint: 60 });
        expect(s.pacePerPointSec).toBeNull();
        expect(s.projectionSec).toBeNull();
        expect(s.barFraction).toBeNull();
        expect(s.overGuide).toBe(false);
        expect(Number.isFinite(s.pacePerPointSec as number)).toBe(false); // null, not Infinity
    });

    it('no guide set → guide/projection/bar all null (the card is the count alone)', () => {
        const s = computePaceStats({ elapsedSec: 150, coveredCount: 2, totalPoints: 3, guideSecPerPoint: null });
        expect(s.pacePerPointSec).toBe(75); // the average still exists…
        expect(s.guideTotalSec).toBeNull(); // …but there is nothing to project against
        expect(s.projectionSec).toBeNull();
        expect(s.barFraction).toBeNull();
        expect(s.overGuide).toBe(false);
    });

    it('under the guide → not over, bar under 1', () => {
        const s = computePaceStats({ elapsedSec: 90, coveredCount: 2, totalPoints: 3, guideSecPerPoint: 60 }); // 45/pt
        expect(s.overGuide).toBe(false);
        expect(s.barFraction).toBeCloseTo(0.75, 5);
    });

    it('bar fill clamps at 1 when way over guide (never overflows the track)', () => {
        const s = computePaceStats({ elapsedSec: 600, coveredCount: 2, totalPoints: 3, guideSecPerPoint: 60 });
        expect(s.barFraction).toBe(1);
    });
});

describe('paceNudgeWarranted (#1046 §2 nudge)', () => {
    const base = { totalPoints: 3, guideSecPerPoint: 60 };
    it('fires only when over guide (beyond ~10%) AND points remain', () => {
        expect(paceNudgeWarranted({ ...base, elapsedSec: 150, coveredCount: 2 })).toBe(true); // 75/pt > 66
    });
    it('silent within the ~10% tolerance', () => {
        expect(paceNudgeWarranted({ ...base, elapsedSec: 128, coveredCount: 2 })).toBe(false); // 64/pt < 66
    });
    it('never before the first point is covered (no average)', () => {
        expect(paceNudgeWarranted({ ...base, elapsedSec: 300, coveredCount: 0 })).toBe(false);
    });
    it('never once the last point is covered — overrunning then costs nothing', () => {
        expect(paceNudgeWarranted({ ...base, elapsedSec: 600, coveredCount: 3 })).toBe(false);
    });
    it('never fires with no guide (that path falls back to a coverage-only nudge elsewhere)', () => {
        expect(paceNudgeWarranted({ elapsedSec: 600, coveredCount: 1, totalPoints: 3, guideSecPerPoint: null })).toBe(false);
    });
});

describe('paceNudgeMessage (#1046 §2 tone)', () => {
    it('names the projection then the next action; contains no banned shortfall words', () => {
        const msg = paceNudgeMessage(180, 3);
        expect(msg).toBe("At this pace you'd run a little past 3 min. Point 3 whenever you're ready.");
        for (const banned of ['behind', 'missed', 'untouched', "haven't", 'running out', 'seconds in']) {
            expect(msg.toLowerCase()).not.toContain(banned);
        }
    });
});
