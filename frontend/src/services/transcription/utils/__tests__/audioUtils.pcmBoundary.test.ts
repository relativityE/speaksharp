/* @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Result } from '../../modes/types';
import { PRIV_STT, PRIV_STT_DERIVED } from '../../sttConstants';
import { captureForPcm } from '../../pcmBoundaryReceipt';

const engine = vi.hoisted(() => ({
  transcribe: vi.fn(), init: vi.fn(), start: vi.fn(), stop: vi.fn(), destroy: vi.fn(),
}));
vi.unmock('../../modes/PrivateWhisper');
vi.mock('@xenova/transformers', () => ({}));
vi.mock('../../../audio/pauseDetector', () => ({ PauseDetector: vi.fn(() => ({
  isMeaningfullySilent: () => false, processAudioFrame: () => {}, getCurrentSilenceDurationSeconds: () => 0,
})) }));
vi.mock('../../engines/PrivateSTT', () => ({
  createPrivateSTT: () => ({ ...engine, getEngineType: () => 'transformers-js' }),
}));

import PrivateWhisper from '../../modes/PrivateWhisper';
import { createMicStreamImpl } from '../audioUtils.impl';

type PortMessage = { kind: string; sequence?: number; sourceStart?: number; pcm?: Float32Array; frames?: number; samples?: number };
class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  port = { onmessage: null as ((event: MessageEvent<unknown>) => void) | null, postMessage: vi.fn() };
  connect = vi.fn((target: unknown) => target);
  disconnect = vi.fn();
  constructor(_context: unknown, _name: string, readonly options: { processorOptions: Record<string, unknown> }) {
    FakeWorkletNode.instances.push(this);
  }
  emit(data: PortMessage): void { this.port.onmessage?.({ data } as MessageEvent<unknown>); }
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'running';
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  source = { connect: vi.fn((target: unknown) => target), disconnect: vi.fn() };
  gain = { gain: { value: 1 }, connect: vi.fn((target: unknown) => target), disconnect: vi.fn() };
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  createMediaStreamSource = vi.fn(() => this.source);
  createGain = vi.fn(() => this.gain);
  createOscillator = vi.fn();
  createMediaStreamDestination = vi.fn();
  constructor(_options: AudioContextOptions) { FakeAudioContext.instances.push(this); }
}

const trackStop = vi.fn();
const mediaStream = {
  getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) }],
  getTracks: () => [{ stop: trackStop }],
} as unknown as MediaStream;
const originalAudioContext = window.AudioContext;
const originalMediaDevices = navigator.mediaDevices;
let captureOrdinal = 1;
const nextCaptureId = () => `00000000-0000-4000-8000-${String(captureOrdinal++).padStart(12, '0')}`;
const latestReceipt = async () => {
  const records = await window.__PRIVATE_PCM_RECEIPTS__?.read() as Array<{
    captureId: string; complete: boolean; workletClosed: boolean; listenerClosed: boolean;
    problems: string[]; receipts: Array<{ domain: string }>;
  }>;
  return records[records.length - 1]!;
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); FakeWorkletNode.instances = []; FakeAudioContext.instances = [];
  vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID: vi.fn(nextCaptureId) });
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia: vi.fn(async () => mediaStream) },
  });
  Object.defineProperty(globalThis, '__TEST__', { configurable: true, value: true });
  window.__SS_E2E__ = { isActive: true, engineType: 'real' };
  window.__PRIVATE_PCM_RECEIPTS_ENABLED__ = true;
  engine.init.mockResolvedValue(Result.ok('transformers-js'));
  engine.transcribe.mockResolvedValue(Result.ok('A grounded synthetic sentence.'));
  engine.destroy.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  delete window.__SS_E2E__; delete window.__PRIVATE_PCM_RECEIPTS_ENABLED__; delete window.__PRIVATE_PCM_RECEIPTS__;
  delete (globalThis as { __TEST__?: boolean }).__TEST__;
  if (originalAudioContext) Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext });
  else Reflect.deleteProperty(window, 'AudioContext');
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('composes actual mic transport, queued worklet packet and PrivateWhisper facade into one complete receipt', async () => {
  const stream = await createMicStreamImpl({ sampleRate: 16_000, frameSize: 1024 });
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  await mode.init(); await mode.start(stream);
  expect((mode as unknown as { privateSTT: { transcribe: unknown } }).privateSTT.transcribe).toBe(engine.transcribe);
  const node = FakeWorkletNode.instances[0], context = FakeAudioContext.instances[0];
  expect(node.options.processorOptions).toMatchObject({ targetSampleRate: 16_000, frameSize: 1024, pcmReceipt: true });

  const frame = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.25);
  node.emit({ kind: 'speaksharp-pcm-frame-v1', sequence: 0, sourceStart: 0, pcm: frame });
  await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
  expect(engine.transcribe).toHaveBeenCalled();

  // Stop transport, then deliver a packet that was already queued by the worklet. It must still
  // reach the facade before the final producer watermark rather than being silently discarded.
  stream.stop();
  const queued = new Float32Array(frame.length).fill(0.5);
  node.emit({ kind: 'speaksharp-pcm-frame-v1', sequence: 1, sourceStart: frame.length, pcm: queued });
  await mode.stop();
  node.emit({ kind: 'speaksharp-pcm-closed-v1', frames: 2, samples: frame.length + queued.length });

  const receipt = await latestReceipt();
  expect(receipt.complete).toBe(true); expect(receipt.problems).toEqual([]);
  expect(receipt.receipts.map(row => row.domain)).toEqual(expect.arrayContaining([
    'worklet_output', 'listener_delivery', 'live_decode_input', 'final_decode_input',
  ]));
  expect(node.port.postMessage).toHaveBeenCalledTimes(1);
  expect(node.port.postMessage).toHaveBeenCalledWith({ kind: 'speaksharp-pcm-finish-v1' });
  expect(context.close).toHaveBeenCalledTimes(1); expect(trackStop).toHaveBeenCalledTimes(1);

  stream.close();
  expect(node.port.postMessage).toHaveBeenCalledTimes(1);
  expect(context.close).toHaveBeenCalledTimes(1); expect(trackStop).toHaveBeenCalledTimes(1);
});

it('bounds teardown when the producer watermark never arrives and rejects later packets as proof', async () => {
  const stream = await createMicStreamImpl({ sampleRate: 16_000, frameSize: 1024 });
  const node = FakeWorkletNode.instances[0], context = FakeAudioContext.instances[0];
  const frame = new Float32Array([0.5, -0.5]);
  node.emit({ kind: 'speaksharp-pcm-frame-v1', sequence: 0, sourceStart: 0, pcm: frame });
  const capture = captureForPcm(frame);
  expect(capture).toBeDefined();
  capture?.listener(frame); capture?.decode(frame, false); capture?.decode(frame, true); capture?.closeListener();

  stream.stop(); stream.close();
  expect(node.port.postMessage).toHaveBeenCalledTimes(1); expect(trackStop).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1001);
  expect(context.close).toHaveBeenCalledTimes(1);

  // A packet after the timeout cannot revive or complete the displaced capture.
  node.emit({ kind: 'speaksharp-pcm-frame-v1', sequence: 1, sourceStart: frame.length, pcm: frame });
  const receipt = await latestReceipt();
  expect(receipt.complete).toBe(false);
  expect(receipt).toMatchObject({ workletClosed: true, listenerClosed: true });
  expect(receipt.problems).toEqual(expect.arrayContaining(['worklet-metadata', 'late-frame']));
});
