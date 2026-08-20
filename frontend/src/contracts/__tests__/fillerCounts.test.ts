import { describe, it, expect } from 'vitest';
import { validatePersistedFillerCounts, readPersistedFillerCounts, persistedFillerTotal, APPROVED_FILLER_KEYS } from '../fillerCounts';
import { canonicalFillerKey } from '@/utils/nextAction';
import { FILLER_WORD_KEYS } from '@/config';

const PROSE = 'confidential project phrase';

describe('#1306 persisted filler_counts contract — approved keys only, fail closed', () => {
  it('accepts {} as a genuine MEASURED zero', () => {
    expect(validatePersistedFillerCounts({})).toEqual({ ok: true, value: {} });
  });

  it('accepts approved standard keys with non-negative finite numbers', () => {
    expect(validatePersistedFillerCounts({ um: 3, uh: 0, like: 2 })).toEqual({ ok: true, value: { um: 3, uh: 0, like: 2 } });
  });

  it('REJECTS an unknown PROSE key with a CODE ONLY — the phrase is never echoed', () => {
    const r = validatePersistedFillerCounts({ [PROSE]: 1 });
    expect(r).toEqual({ ok: false, code: 'invalid_filler_counts_key' });
    // No-leak: the offending phrase must not appear anywhere in the serialized result.
    expect(JSON.stringify(r)).not.toContain(PROSE);
    expect(JSON.stringify(r)).not.toMatch(/confidential/i);
  });

  it('REJECTS nested/array/string/negative/non-finite with sanitized codes (fail closed)', () => {
    expect(validatePersistedFillerCounts({ um: { count: 3 } })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(validatePersistedFillerCounts([1, 2] as unknown)).toEqual({ ok: false, code: 'invalid_filler_counts_shape' });
    expect(validatePersistedFillerCounts({ um: 'lots and lots' })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(validatePersistedFillerCounts({ um: -1 })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(validatePersistedFillerCounts({ um: Number.NaN })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(validatePersistedFillerCounts(null)).toEqual({ ok: false, code: 'invalid_filler_counts_shape' });
    expect(validatePersistedFillerCounts('um so')).toEqual({ ok: false, code: 'invalid_filler_counts_shape' });
  });

  // ALLOWLIST PARITY: the live-detection list (config FILLER_WORD_KEYS) must canonicalize EXACTLY to the
  // approved-key allowlist — no independently-maintained list can silently drift.
  it('the approved allowlist is EXACTLY the canonicalized live-detection list (no drift)', () => {
    const liveCanonical = Object.values(FILLER_WORD_KEYS).map((k) => canonicalFillerKey(k)).sort();
    expect(liveCanonical).toEqual([...APPROVED_FILLER_KEYS].sort());
    expect(APPROVED_FILLER_KEYS.length).toBe(13);
  });

  it('readPersistedFillerCounts distinguishes measured-zero ({}) from not-measured/invalid (null)', () => {
    expect(readPersistedFillerCounts({})).toEqual({});                     // measured zero
    expect(readPersistedFillerCounts(null)).toBeNull();                    // not measured
    expect(readPersistedFillerCounts(undefined)).toBeNull();              // not measured
    expect(readPersistedFillerCounts({ 'prose key': 1 })).toBeNull();      // invalid → fail closed (excluded)
    expect(readPersistedFillerCounts({ um: { count: 4 } })).toBeNull();    // nested persisted → rejected
    expect(readPersistedFillerCounts({ um: 4 })).toEqual({ um: 4 });
  });

  it('persistedFillerTotal: null for not-measured/invalid, 0 for {}, sum for counts', () => {
    expect(persistedFillerTotal(null)).toBeNull();
    expect(persistedFillerTotal({ 'prose': 1 })).toBeNull();
    expect(persistedFillerTotal({})).toBe(0);
    expect(persistedFillerTotal({ um: 3, uh: 2 })).toBe(5);
  });

  // #1306 P1: the client value constraint MUST match the DB firewall — a non-negative INTEGER within range.
  // A client that accepted fractional/over-limit values would build a map the DB then rejects at the boundary.
  it('REJECTS a FRACTIONAL count (DB requires integer) — whole map fails closed', () => {
    expect(validatePersistedFillerCounts({ um: 2.5 })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    // a mixed valid+fractional map is rejected WHOLESALE (never partially kept)
    expect(validatePersistedFillerCounts({ um: 3, uh: 0.1 })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(readPersistedFillerCounts({ um: 3, uh: 0.1 })).toBeNull();
  });

  it('REJECTS an OVER-LIMIT count (> 1_000_000) but ACCEPTS the boundary value', () => {
    expect(validatePersistedFillerCounts({ um: 1_000_001 })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
    expect(validatePersistedFillerCounts({ um: 1_000_000 })).toEqual({ ok: true, value: { um: 1_000_000 } });
    expect(readPersistedFillerCounts({ um: 1_000_001 })).toBeNull(); // over-limit → unavailable wholesale
  });

  it('REJECTS Infinity (excluded by the integer check)', () => {
    expect(validatePersistedFillerCounts({ um: Number.POSITIVE_INFINITY })).toEqual({ ok: false, code: 'invalid_filler_counts_value' });
  });
});
