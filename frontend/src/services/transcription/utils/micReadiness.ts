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
 * pipeline is actually delivering stable, clean frames. This is the deterministic gate
 * behind that cue. It is NOT a dumb timer: it requires N consecutive *clean* frames
 * (finite, not all-zero init frames) AND a minimum warmup elapsed — so a slow-warming
 * device naturally waits longer (its early frames are degenerate and reset the counter),
 * while a fast device is bounded by the time floor.
 *
 * IMPORTANT: this gates the user CUE only. Capture-from-start keeps buffering underneath
 * from frame 1 — we never delay or drop the buffer, we only delay telling the user to speak.
 */

/**
 * A mic frame is "clean" (real audio, not an uninitialized/garbage init frame) when every
 * sample is finite and the frame is not entirely zero. getUserMedia/worklet warmup commonly
 * emits all-zero (and occasionally NaN) frames before the graph is truly running.
 */
export function isCleanAudioFrame(frame: Float32Array | null | undefined): boolean {
  if (!frame || frame.length === 0) return false;
  let sawNonZero = false;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (!Number.isFinite(v)) return false; // NaN/Inf => init garbage
    if (!sawNonZero && v !== 0) sawNonZero = true;
  }
  return sawNonZero; // all-exactly-zero => uninitialized/silent init frame
}

/**
 * Fires exactly once, when the mic is genuinely ready for the user to speak.
 * Stateful + side-effect-free (the caller decides what to do when it fires).
 */
export class MicReadinessGate {
  private consecutiveClean = 0;
  private firstObservedAtMs: number | null = null;
  private fired = false;

  constructor(
    private readonly minConsecutiveCleanFrames: number,
    private readonly minWarmupMs: number,
  ) {}

  /**
   * Observe one delivered mic frame. Returns true EXACTLY ONCE — on the transition to
   * ready-to-speak. Returns false on every other call (before ready, and after it fired).
   */
  observe(frame: Float32Array | null | undefined, nowMs: number): boolean {
    if (this.fired) return false;
    if (this.firstObservedAtMs === null) this.firstObservedAtMs = nowMs;

    if (isCleanAudioFrame(frame)) {
      this.consecutiveClean++;
    } else {
      this.consecutiveClean = 0; // require CONSECUTIVE clean frames (reset on any garbage)
    }

    const elapsedMs = nowMs - this.firstObservedAtMs;
    if (this.consecutiveClean >= this.minConsecutiveCleanFrames && elapsedMs >= this.minWarmupMs) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** True once the gate has fired (ready to speak). */
  get isReady(): boolean {
    return this.fired;
  }

  /** Reset for a fresh recording. */
  reset(): void {
    this.consecutiveClean = 0;
    this.firstObservedAtMs = null;
    this.fired = false;
  }
}
