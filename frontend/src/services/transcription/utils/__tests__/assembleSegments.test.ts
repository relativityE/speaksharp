import { describe, it, expect } from 'vitest';
import { assembleSegments, type SegmentForAssembly } from '../assembleSegments';
import type { TimedToken } from '../seamReconciliation';

const t = (w: string, ts: number, te: number): TimedToken => ({ w, ts, te });

describe('assembleSegments — segmented finalization assembly (#891 Item 4 core)', () => {
  it('returns empty for 0 segments', () => {
    const r = assembleSegments([]);
    expect(r.transcript).toBe('');
    expect(r.tokens).toEqual([]);
    expect(r.seams).toEqual([]);
    expect(r.flaggedSeams).toBe(0);
  });

  it('returns the single segment text unchanged (no seam) for 1 segment', () => {
    const seg: SegmentForAssembly = {
      index: 0, sliceStartSec: 0, audioEndSec: 3,
      wordTimings: [t('hello', 0.1, 0.5), t('world', 0.6, 1.0)],
    };
    const r = assembleSegments([seg]);
    expect(r.transcript).toBe('hello world');
    expect(r.seams).toHaveLength(0);
    expect(r.flaggedSeams).toBe(0);
  });

  it('folds two overlapping segments, dropping the covered duplicate at the seam', () => {
    // seg0 audio [0,10]; seg1 audio [10,20], slice [8,20] (2s lead-in) -> sliceStartSec 8.
    // "one" is the shared overlap word; seg1 timings are SLICE-LOCAL (0-based at the 8s slice start).
    const seg0: SegmentForAssembly = {
      index: 0, sliceStartSec: 0, audioEndSec: 10,
      wordTimings: [t('this', 9.0, 9.4), t('is', 9.4, 9.6), t('one', 9.6, 9.9)],
    };
    const seg1: SegmentForAssembly = {
      index: 1, sliceStartSec: 8, audioEndSec: 20,
      // slice-local: "one" @1.6-1.9 (global 9.6-9.9, dup of seg0 tail), then NEW "two three"
      wordTimings: [t('one', 1.6, 1.9), t('two', 2.1, 2.4), t('three', 2.4, 2.7)],
    };
    const r = assembleSegments([seg0, seg1]);
    expect(r.transcript).toBe('this is one two three'); // "one" appears exactly once
    expect(r.seams).toHaveLength(1);
    expect(r.seams[0].resolution).toBe('exact_overlap_trim');
    expect(r.flaggedSeams).toBe(0);
  });

  it('is order-independent (sorts by index before folding)', () => {
    const seg0: SegmentForAssembly = { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [t('this', 9.0, 9.4), t('is', 9.4, 9.6), t('one', 9.6, 9.9)] };
    const seg1: SegmentForAssembly = { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [t('one', 1.6, 1.9), t('two', 2.1, 2.4), t('three', 2.4, 2.7)] };
    const r = assembleSegments([seg1, seg0]); // reversed input
    expect(r.transcript).toBe('this is one two three');
  });

  it('a failed/empty segment contributes no tokens and never loses the surrounding text', () => {
    const seg0: SegmentForAssembly = { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [t('alpha', 9.0, 9.5), t('bravo', 9.5, 9.9)] };
    const segEmpty: SegmentForAssembly = { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [] };
    const seg2: SegmentForAssembly = { index: 2, sliceStartSec: 18, audioEndSec: 30, wordTimings: [t('charlie', 2.0, 2.5), t('delta', 2.5, 2.9)] };
    const r = assembleSegments([seg0, segEmpty, seg2]);
    for (const w of ['alpha', 'bravo', 'charlie', 'delta']) expect(r.transcript).toContain(w);
    expect(r.seams).toHaveLength(1); // only the seg0->seg2 seam; the empty segment adds none
  });

  it('preserves NaN-timestamped (uncoverable) tokens — never silently dropped', () => {
    // A boundary hallucination carries NaN timings (wordTimings.ts) -> uncoverable -> kept + flagged.
    const seg0: SegmentForAssembly = { index: 0, sliceStartSec: 0, audioEndSec: 10, wordTimings: [t('real', 9.0, 9.5), { w: 'hallucination', ts: NaN, te: NaN }] };
    const seg1: SegmentForAssembly = { index: 1, sliceStartSec: 8, audioEndSec: 20, wordTimings: [t('next', 2.1, 2.5)] };
    const r = assembleSegments([seg0, seg1]);
    expect(r.transcript).toContain('real');
    expect(r.transcript).toContain('hallucination');
    expect(r.transcript).toContain('next');
  });
});
