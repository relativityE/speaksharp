/**
 * Segment ledger — #891 segmented Private finalization (boundary detection).
 * ============================================================================
 * Decides WHEN to close a segment as capture frames arrive, so long recordings are decoded as
 * bounded overlapping segments (during recording) instead of one whole-utterance decode at Stop.
 * This is pure boundary logic — it emits boundary times + a reason; the caller (PrivateWhisper)
 * slices the accumulated audio (with overlap) and enqueues the decode. Isolated + unit-tested
 * before it touches the frame path, same as the reconciler.
 *
 * Policy (the hard cap is load-bearing — pause detection ALONE would let long uninterrupted
 * speech recreate the original whole-utterance latency problem):
 *   - prefer a PAUSE-aligned close at/after `targetSec` (~20s). A pause BEFORE the target does not
 *     close (avoids short segments); a closed pause-segment is always >= targetSec and <= hardCapSec.
 *   - FORCE close at `hardCapSec` (30s) even with no pause;
 *   - the final tail closes on Stop (`close()`), and is <= hardCapSec because the current segment
 *     always resets at each close.
 *
 * Pause detection consumes the per-frame `energy` (RMS-like) already produced by the capture path.
 * `pauseEnergyThreshold` is telemetry-tuned (like the mic-readiness RMS band), not a magic number.
 */

export type SegmentCloseReason = 'pause' | 'hardCap' | 'stopTail';

export interface ClosedSegment {
  readonly index: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly durationSec: number;
  readonly closedReason: SegmentCloseReason;
}

export interface SegmentLedgerParams {
  /** Target segment length: a pause may only close a segment at/after this (the earliest pause-close). */
  readonly targetSec: number;
  /** Absolute ceiling; force-close here even with no pause. */
  readonly hardCapSec: number;
  /** Silence run required to count as a pause boundary. */
  readonly minPauseMs: number;
  /** Per-frame energy below this counts as silence (telemetry-tuned). */
  readonly pauseEnergyThreshold: number;
}

export const DEFAULT_SEGMENT_LEDGER_PARAMS: SegmentLedgerParams = {
  targetSec: 20,
  hardCapSec: 30,
  minPauseMs: 250,
  pauseEnergyThreshold: 0.01,
};

/**
 * Stateful ledger. Feed it one frame at a time via `observe`; it returns a `ClosedSegment` on the
 * frame that triggers a boundary (else null). Call `close()` once at Stop for the final tail.
 */
export class SegmentLedger {
  private readonly params: SegmentLedgerParams;
  private index = 0;
  private segStartSec = 0;
  private elapsedSec = 0;
  private silenceMs = 0;
  private stopped = false;

  constructor(params: SegmentLedgerParams = DEFAULT_SEGMENT_LEDGER_PARAMS) {
    this.params = params;
  }

  /** Advance by one frame. Returns the segment that just closed, or null. */
  observe(energy: number, frameDurationSec: number): ClosedSegment | null {
    if (this.stopped || frameDurationSec <= 0) return null;
    this.elapsedSec += frameDurationSec;
    this.silenceMs = energy < this.params.pauseEnergyThreshold ? this.silenceMs + frameDurationSec * 1000 : 0;

    let reason: SegmentCloseReason | null = null;
    if (this.elapsedSec >= this.params.hardCapSec) reason = 'hardCap';
    else if (this.elapsedSec >= this.params.targetSec && this.silenceMs >= this.params.minPauseMs) reason = 'pause';
    return reason ? this.emit(reason) : null;
  }

  /** Force-close the current (final) segment at Stop. Returns the tail, or null if empty. */
  close(): ClosedSegment | null {
    if (this.stopped || this.elapsedSec <= 0) {
      this.stopped = true;
      return null;
    }
    this.stopped = true;
    return { index: this.index, startSec: this.segStartSec, endSec: this.segStartSec + this.elapsedSec, durationSec: this.elapsedSec, closedReason: 'stopTail' };
  }

  /** Index of the segment currently open. */
  get currentIndex(): number {
    return this.index;
  }

  /** Audio start (sec) of the segment currently open — the caller uses this to slice with overlap. */
  get currentStartSec(): number {
    return this.segStartSec;
  }

  private emit(reason: SegmentCloseReason): ClosedSegment {
    const seg: ClosedSegment = { index: this.index, startSec: this.segStartSec, endSec: this.segStartSec + this.elapsedSec, durationSec: this.elapsedSec, closedReason: reason };
    this.index += 1;
    this.segStartSec = seg.endSec;
    this.elapsedSec = 0;
    this.silenceMs = 0;
    return seg;
  }
}
