import { describe, it, expect } from 'vitest';
import { reconcileSeam, type TimedToken } from '../seamReconciliation';

// Build a timed-token sequence: words with explicit [ts, te] seconds.
const t = (w: string, ts: number, te: number): TimedToken => ({ w, ts, te });

describe('reconcileSeam — coverage-gated seam reconciliation (#891)', () => {
  it('exact overlap trim: drops the covered curr-head duplicate, no flag', () => {
    // prev ends at 10.0s; curr starts at 8.5s. Overlap [8.5, 10.0]. curr head "the end." dups prev tail.
    const prev = [t('the', 9.0, 9.4), t('end.', 9.4, 9.9)];
    const curr = [t('the', 8.6, 9.0), t('end.', 9.0, 9.5), t('Next', 9.6, 10.1)];
    const r = reconcileSeam(prev, curr, 8.5, 10.0);
    expect(r.metadata.resolution).toBe('exact_overlap_trim');
    expect(r.trimPrev).toBe(0);
    expect(r.curr.map((x) => x.w)).toEqual(['Next']);
    expect(r.metadata.flagged).toBe(false);
    expect(r.metadata.droppedCovered[0].text).toBe('the end.');
  });

  it('asymmetric partial: drops covered curr-head dup, KEEPS+FLAGS out-of-window prev-tail hallucination', () => {
    // Harvard-shape. Overlap [19.3, 20.8]. prev tail = real anchor + a hallucination timestamped @11s (out of window).
    const prev = [
      t('told', 19.0, 19.3),
      t('to', 19.4, 19.6),
      t('frighten', 19.6, 19.9),
      t('him.', 19.9, 20.1),
      t('Dragon', 11.0, 11.4), // hallucination: garbage timestamp ~8s before the overlap
      t('chimp.', 11.4, 11.8),
    ];
    const curr = [
      t('to', 19.4, 19.6),
      t('frighten', 19.6, 19.9),
      t('him,', 19.9, 20.3),
      t('we', 20.9, 21.2),
      t('find', 21.2, 21.5),
    ];
    const r = reconcileSeam(prev, curr, 19.3, 20.8);
    expect(r.metadata.resolution).toBe('asym_splice_partial');
    // prev is kept intact (hallucination not deleted); curr's covered dup head is dropped.
    expect(r.trimPrev).toBe(0);
    expect(r.curr.map((x) => x.w)).toEqual(['we', 'find']);
    expect(r.metadata.droppedCovered.map((s) => s.text)).toContain('to frighten him,');
    expect(r.metadata.retainedFlagged.map((s) => s.text)).toContain('Dragon chimp.');
    expect(r.metadata.reasonRetained).toBe('out_of_window');
    expect(r.metadata.flagged).toBe(true);
  });

  it('no-anchor seam: keeps both and flags (never trims)', () => {
    const prev = [t('alpha', 0.0, 0.5), t('bravo', 0.5, 1.0)];
    const curr = [t('xray', 1.0, 1.5), t('yankee', 1.5, 2.0)];
    const r = reconcileSeam(prev, curr, 0.5, 1.0);
    expect(r.metadata.resolution).toBe('no_bounded_match');
    expect(r.trimPrev).toBe(0);
    expect(r.curr).toHaveLength(2);
    expect(r.metadata.flagged).toBe(true);
    expect(r.metadata.reasonRetained).toBe('no_anchor');
  });

  it('HARD INVARIANT: no dropped span is ever out-of-window', () => {
    const cases: Array<[TimedToken[], TimedToken[], number, number]> = [
      [[t('the', 9.0, 9.4), t('end.', 9.4, 9.9)], [t('the', 8.6, 9.0), t('end.', 9.0, 9.5), t('Next', 9.6, 10.1)], 8.5, 10.0],
      [
        [t('to', 19.4, 19.6), t('frighten', 19.6, 19.9), t('him.', 19.9, 20.1), t('Dragon', 11.0, 11.4), t('chimp.', 11.4, 11.8)],
        [t('to', 19.4, 19.6), t('frighten', 19.6, 19.9), t('him,', 19.9, 20.3), t('we', 20.9, 21.2)],
        19.3,
        20.8,
      ],
    ];
    for (const [prev, curr, tLo, tHi] of cases) {
      const r = reconcileSeam(prev, curr, tLo, tHi);
      for (const span of r.metadata.droppedCovered) {
        expect(span.covered).toBe(true); // a dropped span must be coverage-certified
      }
    }
  });

  it('out-of-window curr-head is NOT dropped (kept + flagged), even with a valid anchor', () => {
    // Anchor matches, but curr-head extends past t_hi -> must keep, not drop.
    const prev = [t('shared', 4.0, 4.5), t('word', 4.5, 5.0)];
    const curr = [t('shared', 4.0, 4.5), t('word', 5.6, 6.2), t('after', 6.2, 6.6)]; // "word" te=6.2 > t_hi=5.0
    const r = reconcileSeam(prev, curr, 3.5, 5.0);
    // curr-head span "shared word" is out-of-window (word te 6.2 > 5.0) -> kept, flagged.
    const droppedOOW = r.metadata.droppedCovered.filter((s) => !s.covered);
    expect(droppedOOW).toHaveLength(0);
    expect(r.metadata.flagged).toBe(true);
  });
});
