/**
 * Mic readiness gate — #891 immediate-start opening loss.
 * ============================================================================
 * Root cause (proven on a real deployed take): when a user clicks Record and starts
 * speaking IMMEDIATELY, the getUserMedia/AudioContext/AudioWorklet pipeline has not yet
 * delivered stable frames. The first ~0.5–0.7s of speech ("My main…") is never delivered
 * to the capture buffer — capture-from-start faithfully begins at frame 1, but frame 1
 * already arrives mid-utterance. Decode padding cannot recover it (the words are absent
 * from the audio), so this is a *capture readiness* problem, not decode or buffering.
 *
 * Fix: a readiness CONTRACT. The UI must not invite speech ("Speak now") until the mic
 * pipeline is actually delivering stable, clean frames. This gate is the deterministic
 * signal behind that cue, and it is QUALITY-driven, not a timer:
 *
 *   - it requires N consecutive CLEAN frames (finite, not all-zero init frames) — proves
 *     frames are genuinely flowing (a fixed timer cannot);
 *   - its clock starts at the FIRST DELIVERED FRAME, not Record-click — a mic slow to
 *     deliver frames delays "Speak now" automatically;
 *   - it releases when the frame RMS STABILIZES (recent frames' spread within a band =
 *     AGC/noise-floor settled), bounded by [minWarmupMs, maxWarmupMs] so a mistuned band
 *     can never fire absurdly early nor hang the cue. The exact band is tuned from the
 *     `mic_ready_to_speak` telemetry (timeToFirstFrame, RMS profile) measured on-device.
 *
 * IMPORTANT: this gates the user CUE only. Capture-from-start keeps buffering from frame 1.
 */

export interface MicReadinessParams {
  /** Consecutive clean frames required before the gate can release. */
  minConsecutiveCleanFrames: number;
  /** Safety floor: never release before this (ms from the first delivered frame). */
  minWarmupMs: number;
  /** Fallback ceiling: always release by this even if RMS never settles (ms from first frame). */
  maxWarmupMs: number;
  /** How many recent clean-frame RMS values define "settled". */
  stabilityWindowFrames: number;
  /** Max-min RMS spread across the window to count as settled (AGC/noise-floor converged). */
  rmsStabilityBand: number;
}

export type MicReadyReason = 'rms_stable' | 'max_warmup_cap';

/** Single-pass frame check: clean (finite, not all-zero) + its RMS. */
export function frameStats(frame: Float32Array | null | undefined): { clean: boolean; rms: number } {
  if (!frame || frame.length === 0) return { clean: false, rms: 0 };
  let sawNonZero = false;
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isFinite(v)) return { clean: false, rms: 0 }; // NaN/Inf => init garbage
    if (!sawNonZero && v !== 0) sawNonZero = true;
    sumSq += v * v;
  }
  return { clean: sawNonZero, rms: Math.sqrt(sumSq / frame.length) };
}

/** Back-compat helper (also used in tests): is this a real (non-zero, finite) frame? */
export function isCleanAudioFrame(frame: Float32Array | null | undefined): boolean {
  return frameStats(frame).clean;
}

/**
 * Fires exactly once, when the mic is genuinely ready for the user to speak.
 * Stateful + side-effect-free (the caller decides what to do when it fires).
 */
export class MicReadinessGate {
  private consecutiveClean = 0;
  private firstObservedAtMs: number | null = null;
  private rmsRing: number[] = [];
  private fired = false;
  private _fireReason: MicReadyReason | null = null;
  private _warmupMsAtFire: number | null = null;

  constructor(private readonly p: MicReadinessParams) {}

  /**
   * Observe one delivered mic frame. Returns true EXACTLY ONCE — on the transition to
   * ready-to-speak. Returns false on every other call (before ready, and after it fired).
   */
  observe(frame: Float32Array | null | undefined, nowMs: number): boolean {
    if (this.fired) return false;
    if (this.firstObservedAtMs === null) this.firstObservedAtMs = nowMs;

    const { clean, rms } = frameStats(frame);
    if (clean) {
      this.consecutiveClean++;
      this.rmsRing.push(rms);
      if (this.rmsRing.length > this.p.stabilityWindowFrames) this.rmsRing.shift();
    } else {
      this.consecutiveClean = 0; // require CONSECUTIVE clean frames (reset on any garbage)
      this.rmsRing = [];
    }

    const elapsedMs = nowMs - this.firstObservedAtMs;
    if (this.consecutiveClean < this.p.minConsecutiveCleanFrames || elapsedMs < this.p.minWarmupMs) {
      return false;
    }

    const stabilized = this.isRmsSettled();
    const cappedOut = elapsedMs >= this.p.maxWarmupMs;
    if (stabilized || cappedOut) {
      this.fired = true;
      this._fireReason = stabilized ? 'rms_stable' : 'max_warmup_cap';
      this._warmupMsAtFire = Number(elapsedMs.toFixed(1));
      return true;
    }
    return false;
  }

  /** True when recent clean-frame RMS has converged (AGC/noise floor settled). */
  private isRmsSettled(): boolean {
    if (this.rmsRing.length < this.p.stabilityWindowFrames) return false;
    let min = Infinity;
    let max = -Infinity;
    for (const r of this.rmsRing) {
      if (r < min) min = r;
      if (r > max) max = r;
    }
    return max - min <= this.p.rmsStabilityBand;
  }

  get isReady(): boolean {
    return this.fired;
  }
  /** Why the gate released (telemetry/tuning). Null until fired. */
  get fireReason(): MicReadyReason | null {
    return this._fireReason;
  }
  /** Elapsed from first delivered frame to release (telemetry/tuning). Null until fired. */
  get warmupMsAtFire(): number | null {
    return this._warmupMsAtFire;
  }
  /** Performance.now() of the first delivered frame (to derive time-to-first-frame). */
  get firstFrameAtMs(): number | null {
    return this.firstObservedAtMs;
  }

  reset(): void {
    this.consecutiveClean = 0;
    this.firstObservedAtMs = null;
    this.rmsRing = [];
    this.fired = false;
    this._fireReason = null;
    this._warmupMsAtFire = null;
  }
}
