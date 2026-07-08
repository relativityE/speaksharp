import { describe, it, expect, beforeEach } from 'vitest';
import {
  toFinalizeEngineKey,
  recordFinalizeRate,
  getFinalizeRate,
  estimateFinalizeSeconds,
} from '../finalizeRateStore';

describe('#34 finalizeRateStore — durable, engine-aware finalize estimate', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('maps runtime engine types to finalize keys', () => {
    expect(toFinalizeEngineKey('transformers-js-v4')).toBe('private_v4');
    expect(toFinalizeEngineKey('transformers-js')).toBe('private_v2');
    expect(toFinalizeEngineKey('assemblyai')).toBe('cloud');
    expect(toFinalizeEngineKey('native')).toBe('native');
    expect(toFinalizeEngineKey(null)).toBe('native');
  });

  it('uses documented per-engine defaults until a real observation exists (NOT one hardcoded rate)', () => {
    expect(getFinalizeRate('private_v2')).toBe(0.27);
    expect(getFinalizeRate('private_v4')).toBe(0.09);
    expect(getFinalizeRate('native')).toBe(0);
    expect(getFinalizeRate('cloud')).toBe(0.02);
  });

  it('prefers the OBSERVED rate once recorded, per engine — self-correcting', () => {
    recordFinalizeRate('private_v4', 0.082);
    // v4 now reflects the measured value, not the 0.09 default; v2 is untouched.
    expect(getFinalizeRate('private_v4')).toBeCloseTo(0.082, 3);
    expect(getFinalizeRate('private_v2')).toBe(0.27);
  });

  it('EMA-smooths successive observations rather than jumping', () => {
    recordFinalizeRate('private_v2', 0.30);
    recordFinalizeRate('private_v2', 0.20);
    // alpha 0.5 → 0.30 then 0.5*0.30 + 0.5*0.20 = 0.25
    expect(getFinalizeRate('private_v2')).toBeCloseTo(0.25, 3);
  });

  it('ignores degenerate observations', () => {
    recordFinalizeRate('private_v4', 0);       // <= 0
    recordFinalizeRate('private_v4', 99);      // absurd
    recordFinalizeRate('private_v4', NaN);     // not finite
    expect(getFinalizeRate('private_v4')).toBe(0.09); // still the default
  });

  it('estimates finalize seconds = recordingSeconds × rate; v4 far below v2 for the same take', () => {
    const rec = 122;
    expect(estimateFinalizeSeconds('private_v2', rec)).toBe(Math.round(122 * 0.27)); // ~33s
    expect(estimateFinalizeSeconds('private_v4', rec)).toBe(Math.round(122 * 0.09)); // ~11s
  });

  it('returns null (no wait shown) for engines with no decode wait or unknown length', () => {
    expect(estimateFinalizeSeconds('native', 122)).toBeNull();
    expect(estimateFinalizeSeconds('cloud', 0)).toBeNull();
    expect(estimateFinalizeSeconds('private_v2', 0)).toBeNull();
  });
});
