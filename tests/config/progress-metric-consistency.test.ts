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
});
