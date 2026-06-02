import { describe, it, expect } from 'vitest';
import {
  readPrivateFinalizeTiming,
  decomposeFinalizeWait,
  readNativeStopTiming,
  readCloudStreamTiming,
  type SttTraceEvent,
} from '../../scripts/lib/sttTiming';

/* -------------------------------------------------------------------------- */
/* PRIVATE                                                                     */
/* -------------------------------------------------------------------------- */
// Mirrors the real washington_01 artifact (Private timeline shape: perfMs + payload).
const privateTimeline: SttTraceEvent[] = [
  { event: 'stream_start', perfMs: 1000, payload: {} },
  { event: 'stop_whole_utterance_decode_start', perfMs: 100000, payload: { utteranceSamples: 1_067_000 } },
  { event: 'whole_utterance_commit_start', perfMs: 100050, payload: { decodeInputDurationMs: 66722.6 } },
  { event: 'whole_utterance_commit_accept', perfMs: 110554, payload: { decodeMs: 10504.1, textLength: 1074 } },
];

describe('readPrivateFinalizeTiming', () => {
  it('extracts decode + input duration + phase spans', () => {
    const t = readPrivateFinalizeTiming(privateTimeline);
    expect(t.committed).toBe(true);
    expect(t.finalInferenceDurationMs).toBe(10504.1);
    expect(t.decodeInputDurationMs).toBe(66722.6);
    expect(t.finalizePhaseWallMs).toBe(10554);
    expect(t.decodeWallMs).toBe(10504);
  });

  it('not-committed when no commit_accept', () => {
    const t = readPrivateFinalizeTiming([
      { event: 'whole_utterance_commit_start', perfMs: 100050, payload: { decodeInputDurationMs: 5000 } },
    ]);
    expect(t.committed).toBe(false);
    expect(t.finalInferenceDurationMs).toBeNull();
    expect(t.decodeInputDurationMs).toBe(5000);
  });

  it('null-safe for empty/missing', () => {
    expect(readPrivateFinalizeTiming(undefined).committed).toBe(false);
    expect(readPrivateFinalizeTiming([]).finalInferenceDurationMs).toBeNull();
  });

  it('uses last occurrence across repeated sessions', () => {
    const t = readPrivateFinalizeTiming([
      { event: 'whole_utterance_commit_accept', perfMs: 5000, payload: { decodeMs: 1111 } },
      { event: 'whole_utterance_commit_accept', perfMs: 9000, payload: { decodeMs: 2222 } },
    ]);
    expect(t.finalInferenceDurationMs).toBe(2222);
  });
});

describe('decomposeFinalizeWait', () => {
  it('attributes wait to decode vs app overhead (~98% decode)', () => {
    const d = decomposeFinalizeWait(10695, readPrivateFinalizeTiming(privateTimeline));
    expect(d.decodeMs).toBe(10504.1);
    expect(d.appOverheadMs).toBeCloseTo(190.9, 1);
    expect(d.decodeShare).toBeCloseTo(0.982, 2);
  });

  it('null breakdown when decode unavailable', () => {
    const d = decomposeFinalizeWait(8000, readPrivateFinalizeTiming([]));
    expect(d.decodeMs).toBeNull();
    expect(d.appOverheadMs).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* NATIVE                                                                      */
/* -------------------------------------------------------------------------- */
// Native trace shape: { t, event, ...flatPayload }. final_candidate AFTER
// recognition_stop_invoked = the late-final failure class.
const nativeTrace: SttTraceEvent[] = [
  { t: 200, event: 'onaudiostart' },
  { t: 1200, event: 'onspeechstart' },
  { t: 1500, event: 'interim_candidate', interimTranscript: 'native microphone' },
  { t: 4000, event: 'final_candidate', finalTranscript: 'native microphone proof' },
  { t: 14000, event: 'recognition_stop_invoked' },
  { t: 14600, event: 'final_candidate', finalTranscript: 'native microphone proof starts now ...' },
  { t: 15000, event: 'recognition_stop_onend' },
];

describe('readNativeStopTiming', () => {
  it('derives onset, first interim/final, stop->onend, and late-final flag', () => {
    const t = readNativeStopTiming(nativeTrace);
    expect(t.onAudioStartMs).toBe(200);
    expect(t.onSpeechStartMs).toBe(1200);
    expect(t.firstInterimMs).toBe(1500);
    expect(t.firstFinalMs).toBe(4000);
    expect(t.stopInvokedMs).toBe(14000);
    expect(t.onEndMs).toBe(15000);
    expect(t.stopToOnEndMs).toBe(1000);
    expect(t.finalAfterStopInvoke).toBe(true); // 14600 final after 14000 stop
  });

  it('finalAfterStopInvoke=false when no final arrives after stop', () => {
    const t = readNativeStopTiming([
      { t: 1500, event: 'interim_candidate' },
      { t: 4000, event: 'final_candidate' },
      { t: 14000, event: 'recognition_stop_invoked' },
      { t: 15000, event: 'recognition_stop_onend' },
    ]);
    expect(t.finalAfterStopInvoke).toBe(false);
  });

  it('null-safe for empty native trace', () => {
    const t = readNativeStopTiming([]);
    expect(t.firstFinalMs).toBeNull();
    expect(t.stopToOnEndMs).toBeNull();
    expect(t.finalAfterStopInvoke).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* CLOUD (reader ready; production trace pending)                              */
/* -------------------------------------------------------------------------- */
const cloudTrace: SttTraceEvent[] = [
  { perfMs: 100, event: 'socket_open' },
  { perfMs: 900, event: 'first_partial' },
  { perfMs: 1600, event: 'first_final' },
  { perfMs: 20000, event: 'stop_invoked' },
  { perfMs: 22500, event: 'termination' },
];

describe('readCloudStreamTiming', () => {
  it('derives open->partial/final and stop->termination tail', () => {
    const t = readCloudStreamTiming(cloudTrace);
    expect(t.openToFirstPartialMs).toBe(800);
    expect(t.openToFirstFinalMs).toBe(1500);
    expect(t.stopToTerminationMs).toBe(2500);
  });

  it('null-safe when cloud trace is absent (no global yet)', () => {
    const t = readCloudStreamTiming(undefined);
    expect(t.socketOpenMs).toBeNull();
    expect(t.stopToTerminationMs).toBeNull();
  });
});
