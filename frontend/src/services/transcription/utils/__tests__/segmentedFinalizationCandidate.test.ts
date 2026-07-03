import { describe, it, expect } from 'vitest';
import { buildSegmentedFinalizationCandidate } from '../segmentedFinalizationCandidate';
import type { SegmentForAssembly } from '../assembleSegments';
import type { TimedToken } from '../seamReconciliation';

const t = (w: string, ts: number, te: number): TimedToken => ({ w, ts, te });

describe('buildSegmentedFinalizationCandidate — #891 Slice 1 structured candidate', () => {
  it('FALLBACK: no segments -> fallbackUsed, reason no_segments, zeroed coverage', () => {
    const c = buildSegmentedFinalizationCandidate([]);
    expect(c.text).toBe('');
    expect(c.fallbackUsed).toBe(true);
    expect(c.fallbackReason).toBe('no_segments');
    expect(c.coverage).toEqual({ segmentCount: 0, decodedSegmentCount: 0, emptySegmentCount: 0, tokenCount: 0 });
    expect(c.segments).toEqual([]);
    expect(c.seams).toEqual([]);
  });

  it('FALLBACK: segments handed in but none decoded -> reason no_decoded_segments (failures counted)', () => {
    // Two segments were closed + attempted, both failed/silent (empty timings). Coverage must show them.
    const segs: SegmentForAssembly[] = [
      { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [] },
      { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [] },
    ];
    const c = buildSegmentedFinalizationCandidate(segs);
    expect(c.fallbackUsed).toBe(true);
    expect(c.fallbackReason).toBe('no_decoded_segments');
    expect(c.coverage.segmentCount).toBe(2);
    expect(c.coverage.decodedSegmentCount).toBe(0);
    expect(c.coverage.emptySegmentCount).toBe(2);
    expect(c.text).toBe('');
    expect(c.segments.every((s) => !s.decoded && s.wordCount === 0)).toBe(true);
  });

  it('USABLE: folds confirmed segments + tail, drops the coverage-certified overlap, no fallback', () => {
    // seg0 audio [0,10]; seg1 (the tail) audio [10,20], slice [8,20]. "one" is the shared overlap word.
    const seg0: SegmentForAssembly = {
      index: 0, sliceStartSec: 0, audioEndSec: 10,
      wordTimings: [t('this', 9.0, 9.4), t('is', 9.4, 9.6), t('one', 9.6, 9.9)],
    };
    const tail: SegmentForAssembly = {
      index: 1, sliceStartSec: 8, audioEndSec: 20,
      wordTimings: [t('one', 1.6, 1.9), t('two', 2.1, 2.4), t('three', 2.4, 2.7)],
    };
    const c = buildSegmentedFinalizationCandidate([seg0, tail]);
    expect(c.text).toBe('this is one two three'); // "one" appears exactly once (covered overlap dropped)
    expect(c.fallbackUsed).toBe(false);
    expect(c.fallbackReason).toBeNull();
    expect(c.flaggedSeams).toBe(0);
    expect(c.seams).toHaveLength(1);
    expect(c.coverage).toEqual({ segmentCount: 2, decodedSegmentCount: 2, emptySegmentCount: 0, tokenCount: 5 });
    expect(c.segments).toEqual([
      { index: 0, wordCount: 3, decoded: true },
      { index: 1, wordCount: 3, decoded: true },
    ]);
  });

  it('SEAM HONESTY: an out-of-window span is KEPT + flagged, never dropped', () => {
    // seg0 tail carries an uncoverable (NaN-timed) boundary hallucination -> cannot prove coverage -> kept+flagged.
    const seg0: SegmentForAssembly = {
      index: 0, sliceStartSec: 0, audioEndSec: 10,
      wordTimings: [t('real', 9.0, 9.5), { w: 'ghost', ts: NaN, te: NaN }],
    };
    const seg1: SegmentForAssembly = {
      index: 1, sliceStartSec: 8, audioEndSec: 20,
      wordTimings: [t('next', 2.1, 2.5)],
    };
    const c = buildSegmentedFinalizationCandidate([seg0, seg1]);
    expect(c.text).toContain('real');
    expect(c.text).toContain('ghost'); // uncoverable span retained, not silently deleted
    expect(c.text).toContain('next');
    expect(c.flaggedSeams).toBeGreaterThanOrEqual(1);
    expect(c.fallbackUsed).toBe(false); // has decoded content -> usable candidate
  });

  it('a mid-recording failed segment is folded as a no-op but counted in coverage', () => {
    const seg0: SegmentForAssembly = { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [t('alpha', 9.0, 9.5), t('bravo', 9.5, 9.9)] };
    const failed: SegmentForAssembly = { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [] };
    const seg2: SegmentForAssembly = { index: 2, sliceStartSec: 18, audioEndSec: 30, wordTimings: [t('charlie', 2.0, 2.5), t('delta', 2.5, 2.9)] };
    const c = buildSegmentedFinalizationCandidate([seg0, failed, seg2]);
    for (const w of ['alpha', 'bravo', 'charlie', 'delta']) expect(c.text).toContain(w);
    expect(c.fallbackUsed).toBe(false);
    expect(c.coverage.segmentCount).toBe(3);
    expect(c.coverage.decodedSegmentCount).toBe(2);
    expect(c.coverage.emptySegmentCount).toBe(1);
    expect(c.segments.find((s) => s.index === 1)?.decoded).toBe(false);
  });

  it('echoes the injected timing verbatim and stays deterministic across calls', () => {
    const segs: SegmentForAssembly[] = [
      { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [t('hello', 9.0, 9.4)] },
      { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [t('world', 2.0, 2.4)] },
    ];
    const timing = { stopToCandidateMs: 42, tailDecodeMs: 7300 };
    const a = buildSegmentedFinalizationCandidate(segs, timing);
    const b = buildSegmentedFinalizationCandidate(segs, timing);
    expect(a.timing).toEqual(timing);
    expect(a.text).toEqual(b.text);
    expect(a.coverage).toEqual(b.coverage);
    expect(a.segments).toEqual(b.segments);
  });

  it('defaults timing to nulls when not provided', () => {
    const c = buildSegmentedFinalizationCandidate([
      { index: 0, sliceStartSec: 0, audioEndSec: 3, wordTimings: [t('x', 0.1, 0.5)] },
    ]);
    expect(c.timing).toEqual({ stopToCandidateMs: null, tailDecodeMs: null });
    expect(c.fallbackUsed).toBe(false);
  });
});
