import { describe, it, expect } from 'vitest';
import { mapWordChunks } from '../wordTimings';

describe('mapWordChunks — word chunks -> TimedToken (#891)', () => {
  it('maps well-formed word chunks', () => {
    const chunks = [
      { text: 'hello', timestamp: [0.1, 0.5] },
      { text: 'world', timestamp: [0.5, 1.0] },
    ];
    expect(mapWordChunks(chunks)).toEqual([
      { w: 'hello', ts: 0.1, te: 0.5 },
      { w: 'world', ts: 0.5, te: 1.0 },
    ]);
  });

  it('keeps a word with missing/garbage timestamps as UNCOVERABLE (NaN), never drops the text', () => {
    const chunks = [
      { text: 'good', timestamp: [1.0, 1.4] },
      { text: 'halluc', timestamp: [null, null] },
      { text: 'tail', timestamp: [2.0, null] },
    ];
    const r = mapWordChunks(chunks);
    expect(r).toHaveLength(3);
    expect(r[1].w).toBe('halluc');
    expect(Number.isNaN(r[1].ts)).toBe(true);
    expect(Number.isNaN(r[1].te)).toBe(true);
    expect(r[2].w).toBe('tail');
    expect(r[2].ts).toBe(2.0);
    expect(Number.isNaN(r[2].te)).toBe(true);
  });

  it('trims text and skips empty / non-string / malformed entries', () => {
    const chunks = [
      { text: ' spaced ', timestamp: [0, 1] },
      { text: '', timestamp: [1, 2] },
      { timestamp: [2, 3] },
      null,
      42,
    ];
    expect(mapWordChunks(chunks)).toEqual([{ w: 'spaced', ts: 0, te: 1 }]);
  });

  it('returns [] for non-array input', () => {
    expect(mapWordChunks(undefined)).toEqual([]);
    expect(mapWordChunks(null)).toEqual([]);
    expect(mapWordChunks('nope')).toEqual([]);
  });
});
