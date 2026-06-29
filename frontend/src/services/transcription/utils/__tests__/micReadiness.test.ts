import { describe, it, expect } from 'vitest';
import { isCleanAudioFrame, MicReadinessGate } from '../micReadiness';

const clean = (n = 1024) => {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = (Math.random() - 0.5) * 0.02; // room-tone level, non-zero
  return f;
};
const allZero = (n = 1024) => new Float32Array(n); // uninitialized/init frame
const withNaN = (n = 1024) => {
  const f = clean(n);
  f[10] = Number.NaN;
  return f;
};

describe('isCleanAudioFrame', () => {
  it('accepts a real (non-zero, finite) frame', () => {
    expect(isCleanAudioFrame(clean())).toBe(true);
  });
  it('rejects an all-zero init frame', () => {
    expect(isCleanAudioFrame(allZero())).toBe(false);
  });
  it('rejects a frame containing NaN/Inf', () => {
    expect(isCleanAudioFrame(withNaN())).toBe(false);
  });
  it('rejects empty/missing frames', () => {
    expect(isCleanAudioFrame(new Float32Array(0))).toBe(false);
    expect(isCleanAudioFrame(null)).toBe(false);
  });
});

describe('MicReadinessGate', () => {
  it('does NOT fire while only init (all-zero) frames arrive', () => {
    const gate = new MicReadinessGate(4, 200);
    let fired = false;
    for (let t = 0; t <= 2000; t += 64) fired = gate.observe(allZero(), t) || fired;
    expect(fired).toBe(false);
    expect(gate.isReady).toBe(false);
  });

  it('does NOT fire before the minimum warmup elapses, even with clean frames', () => {
    const gate = new MicReadinessGate(4, 500);
    // 4 clean frames but only ~256ms elapsed -> time floor not met
    let fired = false;
    [0, 64, 128, 192].forEach((t) => { fired = gate.observe(clean(), t) || fired; });
    expect(fired).toBe(false);
  });

  it('fires exactly once after N consecutive clean frames AND the warmup floor', () => {
    const gate = new MicReadinessGate(4, 200);
    const fires: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i * 64;
      if (gate.observe(clean(), t)) fires.push(t);
    }
    expect(fires.length).toBe(1);
    expect(fires[0]).toBeGreaterThanOrEqual(200); // not before the floor
    expect(gate.isReady).toBe(true);
  });

  it('a garbage frame mid-warmup resets the consecutive-clean counter (delays ready)', () => {
    const gate = new MicReadinessGate(4, 0); // isolate the consecutive-frame requirement
    // 3 clean, then 1 init garbage (resets), so not ready yet at frame 4
    expect(gate.observe(clean(), 0)).toBe(false);
    expect(gate.observe(clean(), 64)).toBe(false);
    expect(gate.observe(clean(), 128)).toBe(false);
    expect(gate.observe(allZero(), 192)).toBe(false); // RESET
    expect(gate.observe(clean(), 256)).toBe(false); // only 1 consecutive again
    expect(gate.observe(clean(), 320)).toBe(false);
    expect(gate.observe(clean(), 384)).toBe(false);
    expect(gate.observe(clean(), 448)).toBe(true); // now 4 consecutive
  });

  it('never fires again after firing once', () => {
    const gate = new MicReadinessGate(2, 0);
    gate.observe(clean(), 0);
    expect(gate.observe(clean(), 64)).toBe(true);
    let fired = false;
    for (let i = 0; i < 10; i++) fired = gate.observe(clean(), 128 + i * 64) || fired;
    expect(fired).toBe(false);
  });
});
