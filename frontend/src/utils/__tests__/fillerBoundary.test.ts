import { describe, it, expect } from 'vitest';
import { getFillerTotal, normalizeFillerCounts } from '@/utils/sessionAnalysis';
import { readPersistedFillerCounts, validatePersistedFillerCounts } from '@/contracts/fillerCounts';
import type { FillerCounts } from '@/utils/fillerWordUtils';

// #1306 BOUNDARY: the `total`/nested filler shape is a LIVE working-memory convenience only. It must normalize
// correctly at the transient live boundary, but it must NEVER be accepted as PERSISTED data — the persisted
// contract is strict-flat approved-keys, and `total`/nested shapes fail closed. This keeps `total` from becoming
// a persistence compatibility escape hatch (which would let a comprehensive scalar masquerade as measured data).
describe('#1306 filler boundary — live total-only normalizes; persisted total/nested is rejected', () => {
  it('LIVE: a total-only snapshot normalizes to its measured total', () => {
    const live: FillerCounts = { total: { count: 4, color: '' } };
    expect(getFillerTotal(live)).toBe(4);
    expect(normalizeFillerCounts(live).total.count).toBe(4);
  });

  it('LIVE: a nested per-key snapshot (no explicit total) normalizes to the summed total', () => {
    const live = { um: { count: 3, color: '' }, uh: { count: 1, color: '' } } as unknown as FillerCounts;
    expect(normalizeFillerCounts(live).total.count).toBe(4);
    expect(getFillerTotal(live)).toBe(4);
  });

  it('PERSISTED: a `total` key is rejected (not an approved standard filler identifier)', () => {
    expect(readPersistedFillerCounts({ total: 4 })).toBeNull();
    const v = validatePersistedFillerCounts({ total: 4 });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.code).toBe('invalid_filler_counts_key');
  });

  it('PERSISTED: a nested `{ um: { count } }` shape is rejected (value must be a plain number)', () => {
    expect(readPersistedFillerCounts({ um: { count: 2 } })).toBeNull();
    const v = validatePersistedFillerCounts({ um: { count: 2 } });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.code).toBe('invalid_filler_counts_value');
  });

  it('PERSISTED: the strict flat approved-key shape is accepted (incl. {} = measured zero)', () => {
    expect(readPersistedFillerCounts({ um: 3, uh: 1 })).toEqual({ um: 3, uh: 1 });
    expect(readPersistedFillerCounts({})).toEqual({}); // measured zero
  });
});
