import { describe, it, expect } from 'vitest';
import { compareTranscripts } from '../transcriptShadowMetrics';

describe('compareTranscripts — shadow comparison metrics (#891)', () => {
  it('identical transcripts → similarity 1, zero delta', () => {
    const r = compareTranscripts('hello world this is a test', 'Hello, world. This is a test!');
    expect(r.assembledTokenCount).toBe(6);
    expect(r.wholeUtteranceTokenCount).toBe(6);
    expect(r.tokenCountDelta).toBe(0);
    expect(r.similarity).toBe(1);
  });

  it('both empty → similarity 1 (nothing to disagree on)', () => {
    const r = compareTranscripts('', '');
    expect(r.assembledTokenCount).toBe(0);
    expect(r.wholeUtteranceTokenCount).toBe(0);
    expect(r.similarity).toBe(1);
  });

  it('one empty → similarity 0, signed delta', () => {
    const r = compareTranscripts('one two three', '');
    expect(r.tokenCountDelta).toBe(3); // assembled has 3 more
    expect(r.similarity).toBe(0);
    const r2 = compareTranscripts('', 'one two');
    expect(r2.tokenCountDelta).toBe(-2);
    expect(r2.similarity).toBe(0);
  });

  it('partial overlap → similarity between 0 and 1', () => {
    // assembled: a b c d ; whole: a b x y → intersection {a,b}=2, dice = 2*2/(4+4)=0.5
    const r = compareTranscripts('a b c d', 'a b x y');
    expect(r.similarity).toBe(0.5);
    expect(r.tokenCountDelta).toBe(0);
  });

  it('multiset: a seam duplication (extra repeated word) lowers similarity + shows a positive delta', () => {
    // assembled duplicated "the" once at a seam vs the clean whole-utterance.
    const r = compareTranscripts('meet me at the the station', 'meet me at the station');
    expect(r.tokenCountDelta).toBe(1); // one extra token
    expect(r.similarity).toBeLessThan(1);
    expect(r.similarity).toBeGreaterThan(0.8);
  });

  it('normalization ignores case/punctuation but keeps word identity', () => {
    const r = compareTranscripts("Don't STOP now.", 'dont stop now');
    // 3 tokens each; "don't" (apostrophe kept) vs "dont" differ, "stop"/"now" match → 2/3 overlap.
    expect(r.assembledTokenCount).toBe(3);
    expect(r.wholeUtteranceTokenCount).toBe(3);
    expect(r.similarity).toBeCloseTo(2 / 3, 2);
  });
});
