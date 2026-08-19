import { describe, it, expect } from 'vitest';
import { flattenToFillerCounts, deriveNextActionSignal, CANONICAL_FILLER_KEYS } from '@/utils/nextAction';
import { validateNextActionSignal } from '@/contracts/nextActionSignal';
import type { FillerCounts } from '@/utils/fillerWordUtils';

const fc = (o: Record<string, number>): FillerCounts => {
  const out: FillerCounts = { total: { count: 0, color: '' } } as FillerCounts;
  for (const [k, v] of Object.entries(o)) out[k] = { count: v, color: '' };
  return out;
};

describe('#1306 flattenToFillerCounts — strict flat standard-key map', () => {
  it('maps display keys to canonical tokens and drops total/custom/non-standard', () => {
    const flat = flattenToFillerCounts(fc({ um: 3, 'You Know': 2, 'I Mean': 1, myBrandName: 9, total: 6 }));
    expect(flat).toEqual({ um: 3, you_know: 2, i_mean: 1 });
    // Every produced key is in the canonical (firewall) set.
    for (const k of Object.keys(flat)) expect(CANONICAL_FILLER_KEYS as readonly string[]).toContain(k);
  });

  it('drops negative / non-finite / non-numeric counts and truncates to integers', () => {
    const flat = flattenToFillerCounts(fc({ um: -1, uh: 2.9, ah: Number.NaN }));
    expect(flat).toEqual({ uh: 2 });
  });

  it('is content-free on null/garbage input', () => {
    expect(flattenToFillerCounts(null)).toEqual({});
    expect(flattenToFillerCounts(undefined)).toEqual({});
  });
});

describe('#1306 deriveNextActionSignal — one valid, contract-conformant action', () => {
  const base = { durationSeconds: 120, wordCount: 200, wpm: 140, fillerCounts: {}, clarityScore: 80 };

  it('too little speech → establish baseline', () => {
    const s = deriveNextActionSignal({ ...base, wordCount: 2 });
    expect(s.reasonCode).toBe('ESTABLISH_BASELINE');
    expect(s.comparator).toBe('no_baseline');
  });

  it('high filler rate (>= 3/min) → reduce fillers', () => {
    const s = deriveNextActionSignal({ ...base, fillerCounts: { um: 5, uh: 3 } }); // 8 / 2min = 4/min
    expect(s.reasonCode).toBe('HIGH_FILLER_RATE');
    expect(s.metric).toBe('filler_rate');
    expect(s.value).toBe(4);
  });

  it('too fast (> 150 wpm) → slow down', () => {
    expect(deriveNextActionSignal({ ...base, wpm: 180 }).reasonCode).toBe('PACE_TOO_FAST');
  });

  it('too slow (< 130 wpm) → speed up', () => {
    expect(deriveNextActionSignal({ ...base, wpm: 90 }).reasonCode).toBe('PACE_TOO_SLOW');
  });

  it('within targets → maintain', () => {
    expect(deriveNextActionSignal(base).reasonCode).toBe('ON_TRACK');
  });

  it('#1306: a measured-zero / empty filler count does NOT drive a filler-based next action', () => {
    // {} (measured zero) and an absent filler map both mean "no fillers to reduce" — never HIGH_FILLER_RATE.
    for (const fillerCounts of [{}, {} as Record<string, number>]) {
      const s = deriveNextActionSignal({ ...base, fillerCounts });
      expect(s.reasonCode).not.toBe('HIGH_FILLER_RATE');
      expect(s.actionCode).not.toBe('REDUCE_FILLERS');
    }
  });

  it('every branch returns a signal that passes the strict contract validator', () => {
    const inputs = [
      { ...base, wordCount: 1 },
      { ...base, fillerCounts: { um: 10 } },
      { ...base, wpm: 200 },
      { ...base, wpm: 80 },
      base,
    ];
    for (const i of inputs) expect(validateNextActionSignal(deriveNextActionSignal(i)).ok).toBe(true);
  });
});
