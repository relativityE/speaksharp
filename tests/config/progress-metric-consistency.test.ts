import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MIN_COMPARABLE_SECONDS as MIN_AGG,
  FILLER_RATE_ZERO_QUALITY,
  PACE_IDEAL,
  PACE_TOLERANCE,
  SILENCE_IDEAL,
  SILENCE_TOLERANCE,
} from '../../frontend/src/utils/aggregateProgress';
import { MIN_COMPARABLE_SECONDS as MIN_BASE } from '../../frontend/src/utils/progressVsBaseline';
import { ANALYTICS_THRESHOLDS } from '../../frontend/src/utils/sessionAnalysis';
import * as progressUtils from '../../frontend/src/utils/progressVsBaseline';

/**
 * #1265 — the Progress metric definitions must be consistent across surfaces. The comparability floor and
 * the quality-mapping tunables are the single source of truth in aggregateProgress; progressVsBaseline
 * re-exports the floor. The definition matrix in PROGRESS_AND_NEXT_ACTION.md §5a must not drift from those
 * constants. This test ties the doc to the code so a change to one without the other fails CI.
 */
const DOC = readFileSync(
  path.resolve(__dirname, '../../product_release/PROGRESS_AND_NEXT_ACTION.md'),
  'utf8',
);

describe('#1265 — Progress metric definitions are a single, consistent source', () => {
  it('the comparability floor is defined ONCE and shared (no drift between surfaces)', () => {
    expect(MIN_AGG).toBe(30);
    // progressVsBaseline must expose the SAME value it re-exports from aggregateProgress.
    expect(MIN_BASE).toBe(MIN_AGG);
  });

  it('the definition matrix documents the exact code constants (doc↔code drift guard)', () => {
    expect(DOC).toContain(`MIN_COMPARABLE_SECONDS = ${MIN_AGG}`);
    expect(DOC).toContain(`FILLER_RATE_ZERO_QUALITY = ${FILLER_RATE_ZERO_QUALITY}`);
    expect(DOC).toContain(`PACE_IDEAL = [${PACE_IDEAL.join(',')}]`);
    expect(DOC).toContain(`PACE_TOLERANCE = ${PACE_TOLERANCE}`);
    expect(DOC).toContain(`SILENCE_IDEAL = [${SILENCE_IDEAL.join(',')}]`);
    expect(DOC).toContain(`SILENCE_TOLERANCE = ${SILENCE_TOLERANCE}`);
  });

  it('the matrix names every v1 delivery metric', () => {
    for (const metric of ['Filler rate', 'Clarity', 'Pace', 'Pause rhythm']) {
      expect(DOC).toContain(metric);
    }
  });

  it('Open Mic delivery progress and Focus Points coverage are documented as SEPARATE measures', () => {
    expect(DOC).toMatch(/Open Mic delivery progress and Focus Points coverage are separate/i);
  });

  // #1265 defect 2 — the pace band is a SINGLE user-facing authority (130–150), shared with Session
  // Review / Progress coaching via ANALYTICS_THRESHOLDS. Aggregate Progress must consume it, not maintain
  // its own [120,160].
  it('aggregate Progress consumes the shared 130–150 pace authority (no [120,160] drift)', () => {
    expect(ANALYTICS_THRESHOLDS.TARGET_WPM_MIN).toBe(130);
    expect(ANALYTICS_THRESHOLDS.TARGET_WPM_MAX).toBe(150);
    expect(PACE_IDEAL).toEqual([130, 150]);
    // Identity with the shared authority — a change to the authority moves aggregate Progress in lockstep.
    expect(PACE_IDEAL).toEqual([ANALYTICS_THRESHOLDS.TARGET_WPM_MIN, ANALYTICS_THRESHOLDS.TARGET_WPM_MAX]);
    expect(PACE_IDEAL).not.toEqual([120, 160]);
  });

  it('pace-band boundaries: 130 and 150 are in-band; 125 and 155 are out (matching Session Review)', () => {
    const [lo, hi] = PACE_IDEAL;
    // In-band (the exact user-facing band edges).
    expect(130).toBeGreaterThanOrEqual(lo);
    expect(130).toBeLessThanOrEqual(hi);
    expect(150).toBeGreaterThanOrEqual(lo);
    expect(150).toBeLessThanOrEqual(hi);
    // Just outside — below and above.
    expect(125).toBeLessThan(lo);
    expect(155).toBeGreaterThan(hi);
  });

  // #1265 defect 1 — Focus Points / Open Mic isolation must live in the actual comparison path, not docs.
  // PracticeSession has no durable mode field, so the mode-BLIND client comparison mapper
  // (progressInputsFromSessions/progressFromSessionHistory) — which turned a raw session list into
  // comparison inputs WITHOUT any mode filter — has been removed from the launch authority. The sole live
  // comparison is the server-authoritative read model (loadSessionProgress), which compares only against
  // server-selected same-cohort references. This guard keeps the dead mode-blind mapper from returning.
  it('the launch authority exposes NO mode-blind session→comparison mapper', () => {
    expect((progressUtils as Record<string, unknown>).progressInputsFromSessions).toBeUndefined();
    expect((progressUtils as Record<string, unknown>).progressFromSessionHistory).toBeUndefined();
    const src = readFileSync(path.resolve(__dirname, '../../frontend/src/utils/sessionAnalysis.ts'), 'utf8');
    // No live import path references the removed mapper (a stale comment would be a re-introduction risk).
    expect(src).not.toContain('progressInputsFromSessions');
  });
});
