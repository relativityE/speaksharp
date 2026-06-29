import { describe, it, expect } from 'vitest';
import { isCleanAudioFrame, frameStats, MicReadinessGate, type MicReadinessParams } from '../micReadiness';

// A clean frame at a chosen steady level (deterministic RMS, non-zero).
const at = (level: number, n = 1024) => {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = i % 2 === 0 ? level : -level; // |x| = level => rms = level
  return f;
};
const clean = (n = 1024) => at(0.01, n);
const allZero = (n = 1024) => new Float32Array(n);
const withNaN = (n = 1024) => {
  const f = clean(n);
  f[10] = Number.NaN;
  return f;
};

const params = (over: Partial<MicReadinessParams> = {}): MicReadinessParams => ({
  minConsecutiveCleanFrames: 6,
  minWarmupMs: 250,
  maxWarmupMs: 800,
  stabilityWindowFrames: 6,
  rmsStabilityBand: 0.005,
  ...over,
});

describe('frameStats / isCleanAudioFrame', () => {
  it('reports clean + rms for a real frame', () => {
    const s = frameStats(at(0.02));
    expect(s.clean).toBe(true);
    expect(s.rms).toBeCloseTo(0.02, 4);
  });
  it('rejects all-zero, NaN, empty, null', () => {
    expect(isCleanAudioFrame(allZero())).toBe(false);
    expect(isCleanAudioFrame(withNaN())).toBe(false);
    expect(isCleanAudioFrame(new Float32Array(0))).toBe(false);
    expect(isCleanAudioFrame(null)).toBe(false);
  });
});

describe('MicReadinessGate', () => {
  it('does NOT fire while only init (all-zero) frames arrive', () => {
    const gate = new MicReadinessGate(params());
    let fired = false;
    for (let t = 0; t <= 2000; t += 64) fired = gate.observe(allZero(), t) || fired;
    expect(fired).toBe(false);
    expect(gate.isReady).toBe(false);
  });

  it('does NOT fire before the minimum warmup floor, even when stable', () => {
    const gate = new MicReadinessGate(params({ minWarmupMs: 500 }));
    let fired = false;
    for (let i = 0; i < 6; i++) fired = gate.observe(clean(), i * 30) || fired; // ~150ms < 500
    expect(fired).toBe(false);
  });

  it('releases via RMS stability once frames settle (reason rms_stable, before the cap)', () => {
    const gate = new MicReadinessGate(params());
    const fires: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i * 64;
      if (gate.observe(clean(), t)) fires.push(t); // identical RMS => settled
    }
    expect(fires.length).toBe(1);
    expect(fires[0]).toBeGreaterThanOrEqual(250); // not before the floor
    expect(fires[0]).toBeLessThan(800); // settled before the cap
    expect(gate.fireReason).toBe('rms_stable');
    expect(gate.warmupMsAtFire).toBeGreaterThanOrEqual(250);
  });

  it('falls back to the max-warmup cap when RMS never settles (reason max_warmup_cap)', () => {
    const gate = new MicReadinessGate(params({ rmsStabilityBand: 0.0000001 }));
    let fireT = -1;
    // Wildly varying (but clean) RMS so the spread never fits the band -> only the cap can release.
    const levels = [0.01, 0.2, 0.02, 0.3, 0.05, 0.25, 0.04, 0.28, 0.06, 0.22, 0.03, 0.27, 0.07, 0.21];
    for (let i = 0; i < levels.length; i++) {
      const t = i * 80;
      if (gate.observe(at(levels[i]), t) && fireT < 0) fireT = t;
    }
    expect(fireT).toBeGreaterThanOrEqual(800);
    expect(gate.fireReason).toBe('max_warmup_cap');
  });

  it('a garbage frame resets both the consecutive count and the RMS window', () => {
    const gate = new MicReadinessGate(params({ minWarmupMs: 0, minConsecutiveCleanFrames: 6 }));
    for (let i = 0; i < 5; i++) expect(gate.observe(clean(), i * 64)).toBe(false);
    expect(gate.observe(allZero(), 5 * 64)).toBe(false); // RESET
    // must rebuild 6 consecutive clean + a full RMS window again
    let fired = false;
    for (let i = 6; i < 12; i++) fired = gate.observe(clean(), i * 64) || fired;
    expect(fired).toBe(true);
  });

  it('exposes time-to-first-frame anchoring and never fires twice', () => {
    const gate = new MicReadinessGate(params({ minWarmupMs: 0, minConsecutiveCleanFrames: 2, stabilityWindowFrames: 2 }));
    gate.observe(clean(), 1000); // first frame at t=1000
    expect(gate.firstFrameAtMs).toBe(1000);
    expect(gate.observe(clean(), 1064)).toBe(true);
    let fired = false;
    for (let i = 0; i < 10; i++) fired = gate.observe(clean(), 1200 + i * 64) || fired;
    expect(fired).toBe(false);
  });
});
