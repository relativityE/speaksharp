import { describe, it, expect } from 'vitest';
import {
  distance,
  cumulativeProgress,
  sessionMovementPp,
  median,
  roundPct,
  describeTarget,
  type TargetShape,
} from '../progressMath';

describe('sandbox progressMath — distance()', () => {
  it('lower-is-better threshold', () => {
    const t: TargetShape = { kind: 'lowerThreshold', threshold: 2 };
    expect(distance(8, t)).toBe(6);
    expect(distance(2, t)).toBe(0);
    expect(distance(1, t)).toBe(0); // already past target
  });
  it('higher-is-better threshold', () => {
    const t: TargetShape = { kind: 'upperThreshold', threshold: 80 };
    expect(distance(62, t)).toBe(18);
    expect(distance(90, t)).toBe(0);
  });
  it('target range', () => {
    const t: TargetShape = { kind: 'range', lo: 130, hi: 150 };
    expect(distance(180, t)).toBe(30);
    expect(distance(120, t)).toBe(10);
    expect(distance(140, t)).toBe(0); // inside band
  });
});

describe('sandbox progressMath — cumulativeProgress() (Part A worked examples)', () => {
  const fillers: TargetShape = { kind: 'lowerThreshold', threshold: 2 };

  it('fillers 8 baseline → 6 previous = 33%, → 5 now = 50%, movement +17 pp', () => {
    const prev = cumulativeProgress(8, 6, fillers);
    const cur = cumulativeProgress(8, 5, fillers);
    expect(prev.baselineGap).toBe(6);
    expect(prev.currentGap).toBe(4);
    expect(roundPct(prev.cumulativePct!)).toBe(33);
    expect(cur.currentGap).toBe(3);
    expect(roundPct(cur.cumulativePct!)).toBe(50);
    expect(sessionMovementPp(cur.cumulativePct!, prev.cumulativePct!)).toBe(17);
  });

  it('baseline is FIXED — the same baseline yields a stable scale regardless of previous session', () => {
    // Using previous (6) as if it were the baseline would inflate the current % — prove we do NOT.
    const wrongIfBaselineMoved = cumulativeProgress(6, 5, fillers); // baselineGap 4, currentGap 3 => 25%
    const correct = cumulativeProgress(8, 5, fillers); // fixed baseline 8 => 50%
    expect(roundPct(wrongIfBaselineMoved.cumulativePct!)).toBe(25);
    expect(roundPct(correct.cumulativePct!)).toBe(50);
  });

  it('pace range 180 baseline → 165 now = 50% of the original 30-WPM gap', () => {
    const pace: TargetShape = { kind: 'range', lo: 130, hi: 150 };
    const cur = cumulativeProgress(180, 165, pace);
    expect(cur.baselineGap).toBe(30);
    expect(cur.currentGap).toBe(15);
    expect(roundPct(cur.cumulativePct!)).toBe(50);
  });

  it('already at target at baseline → maintained, no divide-by-zero', () => {
    const r = cumulativeProgress(1.5, 1.4, fillers);
    expect(r.maintained).toBe(true);
    expect(r.cumulativePct).toBeNull();
  });

  it('target reached this session → caps at 100%', () => {
    const r = cumulativeProgress(8, 1, fillers);
    expect(r.atTarget).toBe(true);
    expect(r.cumulativePct).toBe(100);
  });

  it('regression → negative direction internally, flagged regressed', () => {
    const r = cumulativeProgress(6, 7, fillers);
    expect(r.regressed).toBe(true);
    expect(r.cumulativePct!).toBeLessThan(0);
  });
});

describe('sandbox progressMath — helpers', () => {
  it('median of comparable values', () => {
    expect(median([33, 50, 40])).toBe(40);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });
  it('describeTarget wording', () => {
    expect(describeTarget({ kind: 'lowerThreshold', threshold: 2 }, '/min')).toBe('2/min or fewer');
    expect(describeTarget({ kind: 'range', lo: 130, hi: 150 }, ' WPM')).toBe('130–150 WPM');
  });
});
