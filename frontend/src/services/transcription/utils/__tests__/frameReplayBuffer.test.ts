import { describe, it, expect, vi } from 'vitest';
import { FrameReplayBuffer } from '../frameReplayBuffer';

const frame = (fill: number, len = 4) => new Float32Array(len).fill(fill);

describe('FrameReplayBuffer (#960 late-subscriber capture)', () => {
  it('replays every buffered frame, oldest first, to a late subscriber', () => {
    const buf = new FrameReplayBuffer(1000);
    buf.push(frame(1));
    buf.push(frame(2));
    buf.push(frame(3));

    const received: number[] = [];
    buf.replayTo((f) => received.push(f[0]!));

    expect(received).toEqual([1, 2, 3]); // ordered, complete — the opening is not lost
  });

  it('evicts oldest frames once maxSamples is exceeded (bounded memory)', () => {
    const buf = new FrameReplayBuffer(8); // room for 2 frames of length 4
    buf.push(frame(1)); // 4
    buf.push(frame(2)); // 8
    buf.push(frame(3)); // 12 -> evict oldest (1) -> keeps [2,3] = 8

    const received: number[] = [];
    buf.replayTo((f) => received.push(f[0]!));

    expect(received).toEqual([2, 3]);
    expect(buf.bufferedSamples).toBe(8);
  });

  it('retains at least the most recent frame even if it alone exceeds the cap', () => {
    const buf = new FrameReplayBuffer(2);
    buf.push(frame(9, 10)); // one 10-sample frame > cap of 2

    const received: number[] = [];
    buf.replayTo((f) => received.push(f[0]!));

    expect(received).toEqual([9]); // never drops the only frame -> subscriber still gets recent audio
  });

  it('ignores empty frames', () => {
    const buf = new FrameReplayBuffer(1000);
    buf.push(new Float32Array(0));
    buf.push(frame(5));

    const received: number[] = [];
    buf.replayTo((f) => received.push(f[0]!));

    expect(received).toEqual([5]);
    expect(buf.bufferedSamples).toBe(4);
  });

  it('clear() drops all retained frames', () => {
    const buf = new FrameReplayBuffer(1000);
    buf.push(frame(1));
    buf.push(frame(2));
    buf.clear();

    const cb = vi.fn();
    buf.replayTo(cb);

    expect(cb).not.toHaveBeenCalled();
    expect(buf.bufferedSamples).toBe(0);
  });

  it('replay snapshot is stable even if the callback pushes during replay', () => {
    const buf = new FrameReplayBuffer(1000);
    buf.push(frame(1));
    buf.push(frame(2));

    const received: number[] = [];
    buf.replayTo((f) => {
      received.push(f[0]!);
      if (f[0] === 1) buf.push(frame(99)); // must not be replayed in this pass
    });

    expect(received).toEqual([1, 2]);
  });
});
