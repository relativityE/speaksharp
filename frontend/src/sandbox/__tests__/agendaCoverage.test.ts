import { describe, it, expect } from 'vitest';
import { computeAgendaCoverage } from '../agendaCoverage';
import { getFixture, type RehearsalFixture } from '../fixtures';

const partial = getFixture('partial-agenda') as RehearsalFixture;
const recovered = getFixture('recovered-agenda') as RehearsalFixture;

describe('sandbox agendaCoverage — passive coverage (evidence-backed)', () => {
  it('partly-covered agenda yields a mix of covered / partly / not addressed', () => {
    const c = computeAgendaCoverage(partial);
    expect(c.summary.total).toBe(4);
    expect(c.summary.covered).toBe(1);
    expect(c.summary.partial).toBe(1);
    expect(c.summary.notAddressed).toBe(2);
    expect(c.summary.recovered).toBe(0);
    // Every covered/partial point carries attributable transcript evidence; not-addressed carries none.
    const evidenced = c.points.filter((p) => p.state === 'covered' || p.state === 'partial');
    const notAddressed = c.points.filter((p) => p.state === 'not_addressed');
    expect(evidenced.every((p) => p.evidence !== undefined)).toBe(true);
    expect(notAddressed.every((p) => p.evidence === undefined)).toBe(true);
  });
});

describe('sandbox agendaCoverage — recovered after guidance', () => {
  it('remedy point is NOT recovered before the supplement is applied', () => {
    const before = computeAgendaCoverage(recovered, /* applySupplement */ false);
    expect(before.summary.recovered).toBe(0);
    const remedyPoint = before.points[recovered.supplement!.remedyPointIndex];
    expect(remedyPoint.state).toBe('not_addressed');
  });

  it('remedy point becomes recovered ONLY with attributable post-guidance evidence', () => {
    const after = computeAgendaCoverage(recovered, /* applySupplement */ true);
    expect(after.summary.recovered).toBe(1);
    const remedyPoint = after.points[recovered.supplement!.remedyPointIndex];
    expect(remedyPoint.state).toBe('recovered');
    expect(remedyPoint.evidence).toBeDefined();
    // Evidence timestamp must come from the post-guidance supplement, never inferred.
    expect(remedyPoint.evidence!.timestampSec).toBeGreaterThanOrEqual(recovered.supplement!.segment.startSec);
  });
});
