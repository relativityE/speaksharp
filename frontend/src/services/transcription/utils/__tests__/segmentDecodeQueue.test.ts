import { describe, it, expect } from 'vitest';
import { SegmentDecodeQueue, type SegmentDecodeResult } from '../segmentDecodeQueue';
import type { TimedToken } from '../seamReconciliation';

const aud = (sec: number) => new Float32Array(Math.round(sec * 16000));
const tok = (w: string): TimedToken => ({ w, ts: 0, te: 1 });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('SegmentDecodeQueue — serial background decode + queue-depth telemetry (#891)', () => {
  it('processes segments serially, in enqueue order', async () => {
    const seen: SegmentDecodeResult[] = [];
    const q = new SegmentDecodeQueue({ decode: async () => [tok('x')], onResult: (r) => seen.push(r) });
    q.enqueue(0, aud(1), 1);
    q.enqueue(1, aud(1), 1);
    q.enqueue(2, aud(1), 1);
    const all = await q.drain();
    expect(all.map((r) => r.segmentIndex)).toEqual([0, 1, 2]);
    expect(seen.map((r) => r.segmentIndex)).toEqual([0, 1, 2]);
    expect(all.every((r) => r.error === null)).toBe(true);
  });

  it('tracks backlog: depth climbs while a slow decode holds, then drains', async () => {
    const gates = [deferred<readonly TimedToken[]>(), deferred<readonly TimedToken[]>(), deferred<readonly TimedToken[]>()];
    let i = 0;
    const q = new SegmentDecodeQueue({ decode: () => gates[i++].promise });
    q.enqueue(0, aud(1), 1); // seg0 goes in-flight (depth 1)
    q.enqueue(1, aud(1), 1); // waits (depth 2)
    q.enqueue(2, aud(1), 1); // waits (depth 3)
    expect(q.maxQueueDepth).toBe(3);
    gates[0].resolve([tok('a')]);
    await tick();
    gates[1].resolve([tok('b')]);
    await tick();
    gates[2].resolve([tok('c')]);
    await tick();
    const all = await q.drain();
    expect(all.map((r) => r.queueDepthAtEnqueue)).toEqual([0, 1, 2]);
    expect(all.map((r) => r.wordTimings[0].w)).toEqual(['a', 'b', 'c']);
    expect(q.depth).toBe(0);
  });

  it('computes finite rtf and monotonic timing', async () => {
    let t = 0;
    const now = () => (t += 100);
    const q = new SegmentDecodeQueue({ decode: async () => [tok('x')], now });
    q.enqueue(0, aud(2), 2);
    const [r] = await q.drain();
    expect(r.queuedAtMs).toBeLessThanOrEqual(r.startedAtMs);
    expect(r.startedAtMs).toBeLessThanOrEqual(r.finishedAtMs);
    expect(r.decodeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.rtf)).toBe(true);
  });

  it('a decode failure is non-fatal — flagged, queue continues', async () => {
    let n = 0;
    const q = new SegmentDecodeQueue({
      decode: async () => {
        n += 1;
        if (n === 1) throw new Error('boom');
        return [tok('ok')];
      },
    });
    q.enqueue(0, aud(1), 1);
    q.enqueue(1, aud(1), 1);
    const all = await q.drain();
    expect(all[0].error).toBe('boom');
    expect(all[0].wordTimings).toEqual([]);
    expect(all[1].error).toBeNull();
    expect(all[1].wordTimings[0].w).toBe('ok');
  });

  it('drain resolves immediately when the queue is empty', async () => {
    const q = new SegmentDecodeQueue({ decode: async () => [] });
    expect(await q.drain()).toEqual([]);
  });
});
