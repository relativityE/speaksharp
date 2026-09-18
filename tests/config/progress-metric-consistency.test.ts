import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  MIN_COMPARABLE_SECONDS as MIN_AGG,
  FILLER_RATE_ZERO_QUALITY,
  PACE_IDEAL,
  PACE_TOLERANCE,
  SILENCE_IDEAL,
  SILENCE_TOLERANCE,
} from '../../frontend/src/utils/aggregateProgress';
import { ANALYTICS_THRESHOLDS } from '../../frontend/src/utils/sessionAnalysis';

/**
 * #1265 — the Progress metric definitions must be consistent across surfaces. The comparability floor and
 * the quality-mapping tunables are the single source of truth in aggregateProgress. The definition matrix
 * in PROGRESS_AND_NEXT_ACTION.md §5a must not drift from those constants. This test ties the doc to the
 * code so a change to one without the other fails CI.
 *
 * The client-side progress-vs-baseline module and its card were removed with the session redesign (no
 * surface rendered them: the saved review is the single progress authority), so the floor now has exactly
 * one definition, and the guards below assert that directly rather than comparing two copies.
 */
const SRC = path.resolve(__dirname, '../../frontend/src');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}
const PRODUCTION_SOURCES = sourceFiles(SRC).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

const DOC = readFileSync(
  path.resolve(__dirname, '../../product_release/PROGRESS_AND_NEXT_ACTION.md'),
  'utf8',
);

describe('#1265 — Progress metric definitions are a single, consistent source', () => {
  it('the comparability floor is defined ONCE (no second surface can drift from it)', () => {
    expect(MIN_AGG).toBe(30);
    const definitions = PRODUCTION_SOURCES
      .filter(({ text }) => /\bMIN_COMPARABLE_SECONDS\s*=/.test(text))
      .map(({ file }) => path.relative(SRC, file));
    expect(definitions).toEqual(['utils/aggregateProgress.ts']);
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

  // #1265 defect 1 — the mode-BLIND client comparison mapper (progressInputsFromSessions /
  // progressFromSessionHistory) turned a raw session list into comparison inputs with NO mode filter, so it
  // COULD fold a Focus Points session into Open Mic progress. Call-path evidence: at its removal it had ZERO
  // live callers — the only non-test reference anywhere in frontend/src was a comment in sessionAnalysis.ts
  // (verified with `git grep` at the pre-removal commit). Per the guidance it is REMOVED from the launch
  // authority (deleted, not expanded), and this guard keeps it from returning.
  //
  // SCOPE (no overclaim): whether the SERVER excludes Focus Points from Open Mic progress —
  // `record_progress_evaluation()` marking a coverage-scored FP session ineligible for clarity progress, and
  // never selecting it as an Open-Mic comparable reference — is a SERVER-side responsibility
  // (loadSessionProgress only READS server-persisted references). #1280 does NOT assert server-side mode
  // isolation; it removes the client mode-blind path only.
  it('the launch authority exposes NO mode-blind session→comparison mapper, anywhere', () => {
    // Its former home is gone entirely; no production source may reintroduce either name.
    const offenders = PRODUCTION_SOURCES
      .filter(({ text }) => /progressInputsFromSessions|progressFromSessionHistory/.test(text))
      .map(({ file }) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
