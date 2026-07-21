import { describe, it, expect } from 'vitest';
import {
  mapTalkingPointCoverage,
  summarizeCoverage,
  extractKeywords,
  type TranscriptSegment,
} from '../outcomeScorecard';

const segments: TranscriptSegment[] = [
  { text: 'Today I want to walk through the revenue impact and expected growth for next year.', startSec: 0 },
  { text: 'There is some risk here, and our mitigation plan addresses the main concerns.', startSec: 42 },
  { text: 'Thanks for your time, any questions?', startSec: 95 },
];

describe('extractKeywords', () => {
  it('drops stopwords and short tokens', () => {
    expect(extractKeywords('the revenue impact of it')).toEqual(['revenue', 'impact']);
  });
});

describe('mapTalkingPointCoverage', () => {
  it('marks a fully-present point Covered with an exact transcript quote + timestamp', () => {
    const [r] = mapTalkingPointCoverage(['Revenue impact'], segments);
    expect(r.status).toBe('covered');
    expect(r.evidence?.quote).toContain('revenue impact');
    expect(r.evidence?.timestampSec).toBe(0);
  });

  it('marks a partially-present point Partial with evidence', () => {
    // 'timeline' absent, 'growth' present => 1/2 keywords => partial.
    const [r] = mapTalkingPointCoverage(['growth timeline'], segments);
    expect(r.status).toBe('partial');
    expect(r.evidence).toBeDefined();
    expect(r.matchRatio).toBeGreaterThan(0);
    expect(r.matchRatio).toBeLessThan(0.7);
  });

  it('marks an absent point Missing with NO fabricated evidence', () => {
    const [r] = mapTalkingPointCoverage(['competitor pricing benchmark'], segments);
    expect(r.status).toBe('missing');
    expect(r.evidence).toBeUndefined();
  });

  it('handles risk/mitigation coverage from a later segment (correct timestamp)', () => {
    const [r] = mapTalkingPointCoverage(['risk and mitigation'], segments);
    expect(r.status).toBe('covered');
    expect(r.evidence?.timestampSec).toBe(42);
  });

  it('reports a keyword-less point as missing rather than guessing', () => {
    const [r] = mapTalkingPointCoverage(['the of it'], segments); // all stopwords/short
    expect(r.status).toBe('missing');
    expect(r.matchRatio).toBe(0);
  });

  it('summarizes coverage counts', () => {
    const results = mapTalkingPointCoverage(
      ['Revenue impact', 'risk and mitigation', 'competitor pricing benchmark'],
      segments,
    );
    expect(summarizeCoverage(results)).toEqual({ covered: 2, partial: 0, missing: 1, total: 3 });
  });
});
