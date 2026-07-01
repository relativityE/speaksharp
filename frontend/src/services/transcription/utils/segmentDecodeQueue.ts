/**
 * Segment decode queue — #891 segmented Private finalization (background decode scheduling).
 * ============================================================================
 * When a segment closes during recording, its audio is enqueued here for a BACKGROUND decode, so the
 * finalize cost is paid while the user is still speaking instead of all-at-once at Stop. Decodes run
 * SERIALLY — the transformers.js worker processes one transcribe() at a time, so parallel dispatch
 * would not help and would only obscure the real question.
 *
 * That real question is the 5-minute KEEP-PACE gate: do segment decodes keep up with recording, or do
 * they back up? `queueDepthAtEnqueue` (how many were already waiting when a segment was enqueued) and
 * `maxQueueDepth` (the peak) are the signal. If RTF < 1x, each segment decodes faster than the next one
 * records, so depth stays flat/drains → healthy. If depth climbs across a 5-min take, decodes are NOT
 * keeping pace and only the tail-bound-latency claim saves us. This module makes that measurable; the
 * browser timing (~0.4x RTF) predicts flat depth, but only the real continuous take confirms it.
 *
 * Pure + injectable (decode fn + clock) so it is unit-tested in isolation before touching PrivateWhisper.
 * A decode failure is non-fatal: the segment's result carries `error` and the queue continues.
 */

import type { TimedToken } from './seamReconciliation';

export type SegmentDecodeFn = (audio: Float32Array) => Promise<readonly TimedToken[]>;
export type Clock = () => number;

export interface SegmentDecodeResult {
  readonly segmentIndex: number;
  readonly queuedAtMs: number;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly decodeMs: number;
  /** decodeMs / (audioDurationSec * 1000). < 1 = faster than real time (keeps pace). */
  readonly rtf: number;
  /** Items already waiting/in-flight when this segment was enqueued — the backlog signal. */
  readonly queueDepthAtEnqueue: number;
  readonly wordTimings: readonly TimedToken[];
  /** Non-null if the decode threw; the segment is flagged, the queue continues. */
  readonly error: string | null;
}

export interface SegmentDecodeQueueOptions {
  readonly decode: SegmentDecodeFn;
  readonly onResult?: (result: SegmentDecodeResult) => void;
  /** Injectable clock (ms). Defaults to performance.now / Date.now. */
  readonly now?: Clock;
}

interface PendingItem {
  segmentIndex: number;
  audio: Float32Array;
  audioDurationSec: number;
  queuedAtMs: number;
  queueDepthAtEnqueue: number;
}

export class SegmentDecodeQueue {
  private readonly decode: SegmentDecodeFn;
  private readonly onResult?: (result: SegmentDecodeResult) => void;
  private readonly now: Clock;
  private readonly pending: PendingItem[] = [];
  private readonly results: SegmentDecodeResult[] = [];
  private readonly drainWaiters: Array<() => void> = [];
  private running = false;
  private inFlight = 0;
  private peakDepth = 0;

  constructor(options: SegmentDecodeQueueOptions) {
    this.decode = options.decode;
    this.onResult = options.onResult;
    this.now = options.now ?? (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  }

  /** Current backlog: waiting + in-flight. */
  get depth(): number {
    return this.pending.length + this.inFlight;
  }

  /** Peak backlog observed — the keep-pace headline for the whole recording. */
  get maxQueueDepth(): number {
    return this.peakDepth;
  }

  /** Enqueue a closed segment's audio for background decode. */
  enqueue(segmentIndex: number, audio: Float32Array, audioDurationSec: number): void {
    const queueDepthAtEnqueue = this.depth;
    this.pending.push({ segmentIndex, audio, audioDurationSec, queuedAtMs: this.now(), queueDepthAtEnqueue });
    this.peakDepth = Math.max(this.peakDepth, this.depth);
    void this.pump();
  }

  /** Resolves once the queue is fully drained, with every result in enqueue order. */
  async drain(): Promise<readonly SegmentDecodeResult[]> {
    if (!this.running && this.pending.length === 0) return this.results;
    await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
    return this.results;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      const item = this.pending.shift() as PendingItem;
      this.inFlight = 1;
      const startedAtMs = this.now();
      let wordTimings: readonly TimedToken[] = [];
      let error: string | null = null;
      try {
        wordTimings = await this.decode(item.audio);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const finishedAtMs = this.now();
      const decodeMs = Math.max(0, finishedAtMs - startedAtMs);
      const result: SegmentDecodeResult = {
        segmentIndex: item.segmentIndex,
        queuedAtMs: item.queuedAtMs,
        startedAtMs,
        finishedAtMs,
        decodeMs,
        rtf: item.audioDurationSec > 0 ? decodeMs / (item.audioDurationSec * 1000) : 0,
        queueDepthAtEnqueue: item.queueDepthAtEnqueue,
        wordTimings,
        error,
      };
      this.inFlight = 0;
      this.results.push(result);
      this.onResult?.(result);
    }
    this.running = false;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
}
