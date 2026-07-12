/**
 * Bounded replay ring buffer for microphone frames (#960).
 *
 * PROBLEM: `createMicStream` connects the AudioWorklet to the live graph at creation and fans each
 * frame to a listener Set. A consumer that subscribes late — e.g. Private's saved-utterance listener,
 * which attaches only after `PrivateWhisper.onStart`'s setup — misses every frame emitted before it
 * subscribed. On a slow-startup environment that window is several seconds, so the opening of the
 * recording is never captured (confirmed: 28.3s buffer on a 34.5s fixture, no trim).
 *
 * FIX: buffer the most recent frames (bounded) so a late subscriber can be replayed the audio emitted
 * since mic-create. Bounded by `maxSamples` so a long session never grows unbounded — sized to cover
 * the worst realistic subscribe latency, well beyond the observed gap.
 *
 * Frames are stored as-is (callers are expected to pass copies if they will mutate/transfer them).
 */
export class FrameReplayBuffer {
  private frames: Float32Array[] = [];
  private sampleCount = 0;

  constructor(private readonly maxSamples: number) {}

  /** Record a frame, evicting the oldest frames once the buffer exceeds `maxSamples`. */
  push(frame: Float32Array): void {
    if (frame.length === 0) return;
    this.frames.push(frame);
    this.sampleCount += frame.length;
    // Keep at least one frame so a subscriber that attaches right at overflow still gets recent audio.
    while (this.sampleCount > this.maxSamples && this.frames.length > 1) {
      const evicted = this.frames.shift();
      if (evicted) this.sampleCount -= evicted.length;
    }
  }

  /** Replay every buffered frame, oldest first, to a newly-attached subscriber. */
  replayTo(cb: (frame: Float32Array) => void): void {
    // Iterate a snapshot so a callback that (re)subscribes cannot mutate mid-replay.
    for (const frame of this.frames.slice()) cb(frame);
  }

  /** Total buffered samples currently retained (post-eviction). */
  get bufferedSamples(): number {
    return this.sampleCount;
  }

  /** Drop all buffered frames (e.g. on stream teardown). */
  clear(): void {
    this.frames = [];
    this.sampleCount = 0;
  }
}
