import { describe, it, expect } from 'vitest';
import { SegmentLedger, type ClosedSegment } from '../segmentLedger';

const FRAME = 0.064; // ~1024 samples @ 16k
const LOUD = 0.1; // > default pauseEnergyThreshold (0.01)
const SILENT = 0.0;

// Params tuned for a ≤5s Stop tail (#891): targetSec 9, hardCapSec 13.
function feed(ledger: SegmentLedger, energy: number, sec: number, out: ClosedSegment[]): void {
  const n = Math.round(sec / FRAME);
  for (let i = 0; i < n; i++) {
    const c = ledger.observe(energy, FRAME);
    if (c) out.push(c);
  }
}

describe('SegmentLedger — pause-aligned boundaries with hard cap (#891)', () => {
  it('hard-caps a long uninterrupted segment at ~13s', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 15, out); // 15s of continuous speech, no pause
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].closedReason).toBe('hardCap');
    expect(out[0].durationSec).toBeGreaterThanOrEqual(13);
    expect(out[0].durationSec).toBeLessThan(13 + FRAME * 2);
  });

  it('closes pause-aligned at/after the target', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 10, out); // 10s (past the 9s target), continuous -> no boundary yet
    expect(out).toHaveLength(0);
    feed(l, SILENT, 0.4, out); // a real pause -> close
    expect(out).toHaveLength(1);
    expect(out[0].closedReason).toBe('pause');
    expect(out[0].durationSec).toBeGreaterThanOrEqual(9); // a pause never closes before the target
    expect(out[0].durationSec).toBeLessThan(13);
  });

  it('does NOT close on a pause before the target (targetSec is enforced, not a floor)', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 6, out); // 6s: BEFORE the 9s target
    feed(l, SILENT, 0.4, out); // a pause here must NOT close
    expect(out).toHaveLength(0);
    feed(l, LOUD, 8, out); // continue -> hard cap at 13
    expect(out).toHaveLength(1);
    expect(out[0].closedReason).toBe('hardCap');
  });

  it('does not close on a very early pause', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    feed(l, LOUD, 3, out);
    feed(l, SILENT, 0.4, out); // pause at ~3.4s (well before the 9s target) — must NOT close
    expect(out).toHaveLength(0);
    feed(l, LOUD, 11, out); // continue -> hard cap at 13
    expect(out).toHaveLength(1);
    expect(out[0].closedReason).toBe('hardCap');
  });

  it('emits contiguous, indexed segments across multiple boundaries', () => {
    const l = new SegmentLedger();
    const out: ClosedSegment[] = [];
    for (let s = 0; s < 3; s++) {
      feed(l, LOUD, 10, out);
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
    feed(l, LOUD, 10, out); // 10s continuous, no pause -> stays open (< 13s hard cap)
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
    feed(l, LOUD, 60, out); // ~4-5 hard caps
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.every((s) => s.closedReason === 'hardCap')).toBe(true);
    for (const seg of out) expect(seg.durationSec).toBeLessThan(13 + FRAME * 2);
  });
});
