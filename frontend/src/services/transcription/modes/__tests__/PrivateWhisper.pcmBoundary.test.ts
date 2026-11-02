// @vitest-environment happy-dom
// Real capture/facade code; recognizer and microphone hardware are synthetic.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
vi.unmock('../PrivateWhisper');
import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import type { MicStream } from '../../utils/types';
import { beginPcmBoundaryCapture, captureForPcm } from '../../pcmBoundaryReceipt';
import { PRIV_STT, PRIV_STT_DERIVED } from '../../sttConstants';

const engine = vi.hoisted(() => ({ transcribe: vi.fn(), init: vi.fn(), start: vi.fn(), stop: vi.fn() }));
vi.mock('@xenova/transformers', () => ({}));
vi.mock('../../audio/pauseDetector', () => ({ PauseDetector: vi.fn(() => ({
  isMeaningfullySilent: () => false, processAudioFrame: () => {}, getCurrentSilenceDurationSeconds: () => 0,
})) }));
vi.mock('../../engines/PrivateSTT', () => ({ createPrivateSTT: () => ({ ...engine, getEngineType: () => 'transformers-js' }) }));
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.useFakeTimers(); engine.init.mockResolvedValue(Result.ok('transformers-js')); });
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
  delete window.__PRIVATE_PCM_RECEIPTS_ENABLED__; delete window.__PRIVATE_PCM_RECEIPTS__;
});

for (const enabled of [true, false]) it('actual facade buffers and receipt opt-in=' + enabled, async () => {
  window.__PRIVATE_PCM_RECEIPTS_ENABLED__ = enabled;
  const capture = beginPcmBoundaryCapture(16000), calls: Array<{ audio: Float32Array; final: boolean }> = [];
  engine.transcribe.mockImplementation(async (audio: Float32Array, options?: { final?: boolean }) => {
    calls.push({ audio: audio.slice(), final: options?.final === true }); return Result.ok('A specific synthetic sentence.');
  });
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  let listener: ((frame: Float32Array) => void) | undefined;
  const mic: MicStream = { state: 'ready', sampleRate: 16000,
    onFrame: callback => { listener = callback; return () => { listener = undefined; }; }, offFrame: () => {},
    stop: () => {}, close: () => {}, _mediaStream: new MediaStream() };
  try {
    await mode.init(); await mode.start(mic);
    const frame = new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.25);
    capture?.worklet(frame, 0, 0);
    expect(captureForPcm(frame)).toBe(capture);
    if (!listener) throw new Error('real facade listener not installed');
    listener(frame);
    await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
    expect(calls.some(call => !call.final)).toBe(true);
    await mode.stop(); capture?.closeWorklet(1, frame.length);
    expect(calls.some(call => call.final)).toBe(true);
    expect(capture !== undefined).toBe(enabled);
    expect(window.__PRIVATE_PCM_RECEIPTS__ !== undefined).toBe(enabled);
    if (!enabled) return;
    if (!capture) throw new Error('opt-in capture absent');
    const record = await capture.read() as { complete: boolean; receipts: Array<{ domain: string; sha256: string; samples: number; spans: Array<{ start: number; samples: number }> }> };
    expect(record.complete).toBe(true);
    const decoded = record.receipts.filter(row => row.domain === 'live_decode_input' || row.domain === 'final_decode_input');
    expect(decoded).toHaveLength(calls.length);
    calls.forEach((call, index) => {
      const bytes = new Uint8Array(call.audio.length * 4), view = new DataView(bytes.buffer);
      call.audio.forEach((value, i) => view.setFloat32(i * 4, value, true));
      expect(decoded[index].domain).toBe(call.final ? 'final_decode_input' : 'live_decode_input');
      expect(decoded[index].samples).toBe(call.audio.length);
      expect(decoded[index].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(decoded[index].spans.reduce((n, span) => n + span.samples, 0)).toBe(call.audio.length);
    });
    expect(record.receipts.some(row => row.domain === 'worklet_output')).toBe(true);
    expect(record.receipts.some(row => row.domain === 'listener_delivery')).toBe(true);
  } finally { await mode.stop(); capture?.closeWorklet(); }
});
