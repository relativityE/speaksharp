import { describe, it, expect } from 'vitest';
import {
    describeDirection,
    buildTakeaways,
    takeawaysWithinLimits,
    MEANINGFUL_MOVEMENT_POINTS,
    PRACTICE_THIS_NEXT_LABEL,
} from '../progressPresentation';
import { buildProgressEvaluation, type SessionEvidence, type ProgressEvaluation } from '../buildProgressEvaluation';

/**
 * #1045 PR-C — the presentation layer is a Level-1 user-trust surface. These tests pin what must NEVER
 * appear (grades, rankings, absolute scores, fabricated positives) as hard as what must.
 */

const BASE: SessionEvidence = {
    sessionId: 's1', userId: 'u1', status: 'completed',
    durationSeconds: 120, wordCount: 300, hasTranscript: true,
    fillerCount: 6, errorMarkerCount: 0, wpm: 140,
    engine: 'private', engineVersion: 'v2', modelName: 'whisper-base.en',
    attributionStatus: 'verified',
    practiceMode: 'freeform',
};
const mk = (over: Partial<SessionEvidence> = {}) => buildProgressEvaluation({ ...BASE, ...over });
/** Force an exact unrounded clarity value so direction arithmetic is deterministic. */
const withClarity = (e: ProgressEvaluation, clarityRaw: number): ProgressEvaluation => ({ ...e, clarityRaw });

describe('#1045 describeDirection — neutral, non-evaluative movement (§6)', () => {
    it('the first eligible session establishes a baseline, never a fabricated zero', () => {
        const r = describeDirection(mk(), null);
        expect(r.direction).toBe('baseline');
        expect(r.deltaPoints).toBeNull();
        expect(r.text).toContain('Baseline established');
        expect(r.text).not.toMatch(/0%|0 points/);
    });

    it('improvement reads as movement, not praise', () => {
        const r = describeDirection(withClarity(mk(), 84), withClarity(mk({ sessionId: 's0' }), 80));
        expect(r.direction).toBe('improved');
        expect(r.deltaPercent).toBe(5);
        expect(r.text).toBe('Clear delivery improved 5.0% vs your previous comparable session.');
        expect(r.text).not.toMatch(/great|excellent|good|well done|better than/i);
    });

    it('decline reads as movement, not blame', () => {
        const r = describeDirection(withClarity(mk(), 76), withClarity(mk({ sessionId: 's0' }), 80));
        expect(r.direction).toBe('declined');
        expect(r.deltaPercent).toBe(-5);
        expect(r.text).toBe('Clear delivery declined 5.0% vs your previous comparable session.');
        expect(r.text).not.toMatch(/worse|poor|bad|failed|declining/i);
    });

    it('movement below the product policy is honest, not inflated', () => {
        const r = describeDirection(withClarity(mk(), 81.4), withClarity(mk({ sessionId: 's0' }), 80));
        expect(r.direction).toBe('below_policy');
        expect(r.text).toBe('No meaningful change yet.');
        // the sub-point evidence is still carried, it is simply not SHOWN as movement
        expect(r.deltaPoints).toBeCloseTo(1.4, 10);
    });

    it('the meaningful threshold is product policy, applied at the boundary', () => {
        expect(MEANINGFUL_MOVEMENT_POINTS).toBe(3);
        const justUnder = describeDirection(withClarity(mk(), 82.9), withClarity(mk({ sessionId: 's0' }), 80));
        const atThreshold = describeDirection(withClarity(mk(), 83), withClarity(mk({ sessionId: 's0' }), 80));
        expect(justUnder.direction).toBe('below_policy');
        expect(atThreshold.direction).toBe('improved');
    });

    it('arithmetic uses unrounded values; only the display is rounded', () => {
        const r = describeDirection(withClarity(mk(), 84.4), withClarity(mk({ sessionId: 's0' }), 80.1));
        expect(r.deltaPoints).toBeCloseTo(4.3, 10);  // full precision retained
        expect(r.deltaPercent).toBeCloseTo(5.36828963795257, 10);
        expect(r.text).toBe('Clear delivery improved 5.4% vs your previous comparable session.'); // display rounded to ONE decimal
    });

    it('a cohort change restarts the comparison instead of showing a false jump', () => {
        const prev = withClarity(mk({ sessionId: 's0', engine: 'native' }), 60);
        const r = describeDirection(withClarity(mk(), 90), prev);
        expect(r.direction).toBe('unavailable');
        expect(r.reason).toBe('new_cohort');
        expect(r.text).toContain('comparison restarted');
        expect(r.deltaPoints).toBeNull(); // no cross-cohort number is ever computed
    });

    it('fails closed against an INELIGIBLE baseline — never compares to a session that cannot count', () => {
        const ineligibleBaseline = { ...withClarity(mk({ sessionId: 's0' }), 80), eligible: false };
        const r = describeDirection(withClarity(mk(), 90), ineligibleBaseline);
        expect(r.direction).toBe('baseline'); // treated as "no valid comparison yet", never a false jump
        expect(r.deltaPoints).toBeNull();
    });

    it('an ineligible session shows the honest unavailable state', () => {
        const r = describeDirection(mk({ wordCount: 10 }), withClarity(mk({ sessionId: 's0' }), 80));
        expect(r.direction).toBe('unavailable');
        expect(r.reason).toBe('not_eligible');
        expect(r.text).toBe('Not enough comparable data yet');
    });

    it('displays relative movement to ONE decimal (never a whole-percent round)', () => {
        const r = describeDirection(withClarity(mk(), 81), withClarity(mk({ sessionId: 's0' }), 80));
        // 8/80 = 10% → shown to one decimal as "10.0%" (the ".0" proves one-decimal formatting), and the
        // fractional case (5.368% → "5.4%") is pinned by the unrounded-arithmetic test above.
        const clean = describeDirection(withClarity(mk(), 88), withClarity(mk({ sessionId: 's0' }), 80));
        expect(clean.text).toBe('Clear delivery improved 10.0% vs your previous comparable session.');
        expect(r.direction).toBe('below_policy');
    });

    it('a ZERO reference baseline yields a neutral, no-defensible-change state (never improved/declined)', () => {
        // A large raw movement against a zero clear-delivery reference has no defensible percentage.
        const r = describeDirection(withClarity(mk(), 40), withClarity(mk({ sessionId: 's0' }), 0));
        expect(r.direction).not.toBe('improved');
        expect(r.direction).not.toBe('declined');
        expect(r.direction).toBe('below_policy');
        expect(r.deltaPercent).toBeNull();
        expect(r.deltaPoints).toBe(40); // raw points retained
        expect(r.text).toMatch(/no defensible change/i);
        expect(r.text).not.toMatch(/improved|declined|\d+%/i);
    });

    it('NEVER emits a grade, ranking, percentile or absolute score', () => {
        const samples = [
            describeDirection(mk(), null),
            describeDirection(withClarity(mk(), 90), withClarity(mk({ sessionId: 's0' }), 70)),
            describeDirection(withClarity(mk(), 50), withClarity(mk({ sessionId: 's0' }), 70)),
            describeDirection(mk({ wordCount: 5 }), null),
        ];
        for (const s of samples) {
            expect(s.text).not.toMatch(/score|grade|rank|percentile|out of \d|\/10|\/100|top \d|better than/i);
        }
    });
});

describe('#1045 buildTakeaways — exactly two, one of them the action (§7)', () => {
    it('uses the canonical label "Practice this next"', () => {
        expect(PRACTICE_THIS_NEXT_LABEL).toBe('Practice this next');
        expect(PRACTICE_THIS_NEXT_LABEL).not.toMatch(/^Try/);
    });

    it('always yields exactly two takeaways plus a structured target', () => {
        const t = buildTakeaways(mk(), null);
        expect(t.whatWorked.length).toBeGreaterThan(0);
        expect(t.practiceThisNext.length).toBeGreaterThan(0);
        expect(t.target).toMatchObject({
            metric: expect.any(String), direction: expect.any(String),
            targetValue: expect.any(Number), units: expect.any(String),
        });
    });

    it('respects the word limits — 6 and 8 — for every branch', () => {
        const cases = [
            mk(),
            mk({ fillerCount: 60 }),           // high filler
            mk({ wpm: 210 }),                  // too fast
            mk({ wpm: 60 }),                   // too slow
            mk({ fillerCount: 1, wpm: 140 }),  // clean
        ];
        for (const c of cases) {
            const t = buildTakeaways(c, null);
            expect(takeawaysWithinLimits(t), `${t.whatWorked} / ${t.practiceThisNext}`).toBe(true);
        }
    });

    it('the action is measurable — names a metric, a direction and a value', () => {
        const t = buildTakeaways(mk({ fillerCount: 60 }), null);
        expect(t.target.metric).toBe('filler_rate');
        expect(t.target.direction).toBe('decrease');
        expect(t.target.targetValue).toBeGreaterThan(0);
        expect(t.target.units).toBeTruthy();
    });

    it('NEVER fabricates a positive when nothing improved — falls back to a NEUTRAL MEASURED fact', () => {
        // every metric poor: high filler, too fast, and worse than previous
        const current = withClarity(mk({ fillerCount: 90, wpm: 220 }), 40);
        const previous = withClarity(mk({ sessionId: 's0' }), 80);
        const t = buildTakeaways(current, previous);
        // a measured fact about the session, not praise and not participation/completion (§7c).
        expect(t.whatWorked).toMatch(/filler words this session|Pace measured this session/);
        expect(t.whatWorked).not.toMatch(/great|excellent|improv|better|nice|well/i);
        expect(t.whatWorked).not.toMatch(/recorded|saved|finished|completed|showed up|full session/i);
        expect(takeawaysWithinLimits(t)).toBe(true);
    });

    it('recognises a genuine improvement over the previous comparable session', () => {
        const t = buildTakeaways(withClarity(mk(), 88), withClarity(mk({ sessionId: 's0' }), 80));
        expect(t.whatWorked).toBe('Clearer than your last session');
    });

    it('is deterministic — no AI, no randomness', () => {
        expect(buildTakeaways(mk(), null)).toEqual(buildTakeaways(mk(), null));
    });

    it('takeaway copy never claims overall speaking ability', () => {
        for (const c of [mk(), mk({ fillerCount: 90, wpm: 220 }), mk({ wpm: 60 })]) {
            const t = buildTakeaways(c, null);
            for (const s of [t.whatWorked, t.practiceThisNext]) {
                expect(s).not.toMatch(/speaker|speaking ability|overall|score|grade|rank/i);
            }
        }
    });
});

describe('#1045 buildTakeaways — "clearer than last" clears the same gates as direction (review batch 2)', () => {
    const cur = (clarityRaw: number, over: Partial<SessionEvidence> = {}) => withClarity(mk(over), clarityRaw);

    it('a SUB-threshold gain over the previous session is NOT claimed as improvement', () => {
        // +2 points, below the 3-point meaningful-movement policy.
        const t = buildTakeaways(cur(92), cur(90, { sessionId: 's0' }));
        expect(t.whatWorked).not.toBe('Clearer than your last session');
    });

    it('a threshold-meeting gain in the SAME cohort IS claimed', () => {
        const t = buildTakeaways(cur(94, { fillerCount: 30 }), cur(90, { sessionId: 's0', fillerCount: 30 }));
        expect(t.whatWorked).toBe('Clearer than your last session');
    });

    it('a large gain against a DIFFERENT cohort is NOT claimed (setup changed)', () => {
        const previous = cur(80, { sessionId: 's0', modelName: 'other-model' });
        const t = buildTakeaways(cur(95, { fillerCount: 30 }), previous);
        expect(t.whatWorked).not.toBe('Clearer than your last session');
    });

    it('an INELIGIBLE previous session is never used as the comparison', () => {
        const previous = { ...cur(80, { sessionId: 's0' }), eligible: false } as ProgressEvaluation;
        const t = buildTakeaways(cur(95, { fillerCount: 30 }), previous);
        expect(t.whatWorked).not.toBe('Clearer than your last session');
    });
});
