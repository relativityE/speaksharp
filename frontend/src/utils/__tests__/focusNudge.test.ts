import { describe, it, expect } from 'vitest';
import { advanceNudge, initialNudgeState, type NudgeState, type NudgeInputs } from '../focusNudge';

const BANNED = ['behind', 'missed', 'untouched', "haven't", 'running out', 'seconds in', 'still'];
const during = (o: Partial<NudgeInputs>): NudgeInputs => ({
    sessionState: 'during', elapsedSec: 0, coveredCount: 0, totalPoints: 3, guideSecPerPoint: 60, nextPointNumber: 1, ...o,
});

// #1046 G6/G7 §2 — nudge discipline: silent default, 8s hold, 2/run cap, never after last, forward-move tone.
describe('advanceNudge (#1046 §2)', () => {
    it('silent by default — on-pace produces no nudge', () => {
        const s = advanceNudge(initialNudgeState, during({ elapsedSec: 60, coveredCount: 1 })); // 60/pt == guide
        expect(s.activeText).toBeNull();
    });

    it('fires when the average is over the guide and points remain — naming the projection then the action', () => {
        const s = advanceNudge(initialNudgeState, during({ elapsedSec: 150, coveredCount: 2, nextPointNumber: 3 }));
        expect(s.activeText).toBe("At this pace you'd run a little past 3 min. Point 3 whenever you're ready.");
        expect(s.shownCount).toBe(1);
        for (const b of BANNED) expect(s.activeText!.toLowerCase()).not.toContain(b);
    });

    it('holds a shown nudge for at least 8s before it can clear', () => {
        let s = advanceNudge(initialNudgeState, during({ elapsedSec: 150, coveredCount: 2, nextPointNumber: 3 }));
        // Pace instantly recovers, but only 4s have passed → the nudge must stay put.
        s = advanceNudge(s, during({ elapsedSec: 154, coveredCount: 2, nextPointNumber: 3, guideSecPerPoint: 600 }));
        expect(s.activeText).not.toBeNull();
        // After 8s and no longer warranted → clears.
        s = advanceNudge(s, during({ elapsedSec: 159, coveredCount: 2, nextPointNumber: 3, guideSecPerPoint: 600 }));
        expect(s.activeText).toBeNull();
    });

    it('never shows more than two nudges per run', () => {
        let s: NudgeState = initialNudgeState;
        // Nudge 1
        s = advanceNudge(s, during({ elapsedSec: 150, coveredCount: 2, nextPointNumber: 3 }));
        expect(s.shownCount).toBe(1);
        // hold + clear
        s = advanceNudge(s, during({ elapsedSec: 160, coveredCount: 2, nextPointNumber: 3, guideSecPerPoint: 600 }));
        // Nudge 2
        s = advanceNudge(s, during({ elapsedSec: 200, coveredCount: 2, nextPointNumber: 3 }));
        expect(s.shownCount).toBe(2);
        s = advanceNudge(s, during({ elapsedSec: 210, coveredCount: 2, nextPointNumber: 3, guideSecPerPoint: 600 }));
        // A third would-be nudge is refused.
        s = advanceNudge(s, during({ elapsedSec: 260, coveredCount: 2, nextPointNumber: 3 }));
        expect(s.shownCount).toBe(2);
        expect(s.activeText).toBeNull();
    });

    it('never fires once the last point is covered (nextPointNumber null)', () => {
        const s = advanceNudge(initialNudgeState, during({ elapsedSec: 600, coveredCount: 3, nextPointNumber: null }));
        expect(s.activeText).toBeNull();
    });

    it('resets outside the during state', () => {
        const active: NudgeState = { shownCount: 1, activeText: 'x', activeSinceSec: 10 };
        expect(advanceNudge(active, during({ sessionState: 'after' }))).toEqual(initialNudgeState);
        expect(advanceNudge(active, during({ sessionState: 'before' }))).toEqual(initialNudgeState);
    });

    it('no-guide fallback: forward-move coverage nudge only well into the run', () => {
        const noGuide = { guideSecPerPoint: null, coveredCount: 1, totalPoints: 3, nextPointNumber: 2 } as const;
        expect(advanceNudge(initialNudgeState, during({ ...noGuide, elapsedSec: 30 })).activeText).toBeNull();
        const late = advanceNudge(initialNudgeState, during({ ...noGuide, elapsedSec: 90 }));
        expect(late.activeText).toBe('Good moment to bring in point 2.');
        for (const b of BANNED) expect(late.activeText!.toLowerCase()).not.toContain(b);
    });
});
