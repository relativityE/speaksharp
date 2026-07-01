import { describe, it, expect } from 'vitest';
import { SegmentLedger, type ClosedSegment } from '../segmentLedger';

const FRAME = 0.064; // ~1024 samples @ 16k
const LOUD = 0.1; // > default pauseEnergyThreshold (0.01)
const SILENT = 0.0;

function feed(ledger: SegmentLedger, energy: number, sec: number, out: ClosedSegment[]): void {
  const n = Math.round(sec / FRAME);
  for (let i = 0; i < n; i++) {
    const c = ledger.observe(energy, FRAME);
    if (c) out.push(c);
  }
}

describe('SegmentLedger — pause-aligned boundaries with hard cap (#891)', () => {
  it('hard-caps a long uninterrupted segment at ~30s', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 32, out); // 32s of continuous speech, no pause
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].closedReason).toBe('hardCap');
    expect(out[0].durationSec).toBeGreaterThanOrEqual(30);
    expect(out[0].durationSec).toBeLessThan(30 + FRAME * 2);
  });

  it('closes pause-aligned near target once past earliestClose', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 16, out);
    expect(out).toHaveLength(0); // no boundary yet
    feed(l, SILENT, 0.4, out); // a real pause -> close
    expect(out).toHaveLength(1);
    expect(out[0].closedReason).toBe('pause');
    expect(out[0].durationSec).toBeGreaterThanOrEqual(15);
    expect(out[0].durationSec).toBeLessThan(20);
  });

  it('does not close on an early pause before earliestClose', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 5, out);
    feed(l, SILENT, 0.4, out); // pause at ~5.4s (< earliestClose 15) — must NOT close
    expect(out).toHaveLength(0);
    feed(l, LOUD, 26, out); // continue -> hard cap
    expect(out).toHaveLength(1);
    expect(out[0].closedReason).toBe('hardCap');
  });

  it('emits contiguous, indexed segments across multiple boundaries', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    for (let s = 0; s < 3; s++) {
      feed(l, LOUD, 16, out);
      feed(l, SILENT, 0.4, out);
    }
    expect(out).toHaveLength(3);
    out.forEach((seg, i) => expect(seg.index).toBe(i));
    expect(out[0].startSec).toBe(0);
    for (let i = 1; i < out.length; i++) expect(out[i].startSec).toBeCloseTo(out[i - 1].endSec, 5);
  });

  it('close() returns the final tail as stopTail and is idempotent', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 10, out);
    expect(out).toHaveLength(0);
    const tail = l.close();
    expect(tail).not.toBeNull();
    expect(tail?.closedReason).toBe('stopTail');
    expect(tail?.durationSec).toBeCloseTo(10, 0);
    expect(l.close()).toBeNull(); // no double-close
  });

  it('INVARIANT: no closed segment exceeds the hard cap', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 95, out); // ~3 hard caps
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.every((s) => s.closedReason === 'hardCap')).toBe(true);
    for (const seg of out) expect(seg.durationSec).toBeLessThan(30 + FRAME * 2);
  });
});
