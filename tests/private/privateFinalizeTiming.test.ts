import { describe, it, expect } from 'vitest';
import {
  readPrivateFinalizeTiming,
  decomposeFinalizeWait,
  type PrivateTimelineEvent,
} from '../../scripts/lib/privateFinalizeTiming';

// Synthetic timeline mirroring the real washington_01 browser artifact shape:
// decodeMs ~10504, decodeInputDurationMs ~66723, finalizationWait ~10695 -> ~191ms overhead.
const timeline: PrivateTimelineEvent[] = [
  { event: 'stream_start', perfMs: 1000, payload: {} },
  { event: 'stop_whole_utterance_decode_start', perfMs: 100000, payload: { utteranceSamples: 1_067_000 } },
  { event: 'whole_utterance_commit_start', perfMs: 100050, payload: { decodeInputDurationMs: 66722.6 } },
  { event: 'whole_utterance_commit_accept', perfMs: 110554, payload: { decodeMs: 10504.1, textLength: 1074 } },
];

describe('readPrivateFinalizeTiming', () => {
  it('extracts decode + input duration + phase spans from the timeline', () => {
    const t = readPrivateFinalizeTiming(timeline);
    expect(t.committed).toBe(true);
    expect(t.finalInferenceDurationMs).toBe(10504.1);
    expect(t.decodeInputDurationMs).toBe(66722.6);
    expect(t.finalizePhaseWallMs).toBe(10554); // 110554 - 100000
    expect(t.decodeWallMs).toBe(10504); // 110554 - 100050 (≈ decodeMs, sanity)
  });

  it('reports not-committed when no commit_accept event exists', () => {
    const t = readPrivateFinalizeTiming([
      { event: 'stop_whole_utterance_decode_start', perfMs: 100000 },
      { event: 'whole_utterance_commit_start', perfMs: 100050, payload: { decodeInputDurationMs: 5000 } },
    ]);
    expect(t.committed).toBe(false);
    expect(t.finalInferenceDurationMs).toBeNull();
    expect(t.decodeInputDurationMs).toBe(5000);
  });

  it('is null-safe for empty/missing timelines', () => {
    expect(readPrivateFinalizeTiming(undefined).committed).toBe(false);
    expect(readPrivateFinalizeTiming([]).finalInferenceDurationMs).toBeNull();
  });

  it('uses the LAST occurrence when an event repeats across sessions', () => {
    const t = readPrivateFinalizeTiming([
      { event: 'whole_utterance_commit_accept', perfMs: 5000, payload: { decodeMs: 1111 } },
      { event: 'whole_utterance_commit_accept', perfMs: 9000, payload: { decodeMs: 2222 } },
    ]);
    expect(t.finalInferenceDurationMs).toBe(2222);
  });
});

describe('decomposeFinalizeWait', () => {
  it('attributes the wait to decode vs app overhead', () => {
    const t = readPrivateFinalizeTiming(timeline);
    const d = decomposeFinalizeWait(10695, t);
    expect(d.decodeMs).toBe(10504.1);
    expect(d.appOverheadMs).toBeCloseTo(190.9, 1);
    expect(d.decodeShare).toBeCloseTo(0.982, 2); // decode is ~98% of the wait
  });

  it('returns null breakdown fields when decode time is unavailable', () => {
    const d = decomposeFinalizeWait(8000, readPrivateFinalizeTiming([]));
    expect(d.decodeMs).toBeNull();
    expect(d.appOverheadMs).toBeNull();
    expect(d.decodeShare).toBeNull();
  });
});
