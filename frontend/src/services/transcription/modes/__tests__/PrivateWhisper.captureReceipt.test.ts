// @vitest-environment happy-dom
// #1760 evaluator binding: the real PrivateWhisper facade publishes the gated capture receipt that the in-app
// comparison spec and the product-evidence collector read (window.__PRIVATE_CAPTURE_RECEIPT__). Recognizer and
// microphone hardware are synthetic; the facade, listener and receipt code are real.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
vi.unmock('../PrivateWhisper');
import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import type { MicStream } from '../../utils/types';

const engine = vi.hoisted(() => ({ transcribe: vi.fn(), init: vi.fn(), start: vi.fn(), stop: vi.fn(), getMetadata: vi.fn() }));
vi.mock('@xenova/transformers', () => ({}));
vi.mock('../../audio/pauseDetector', () => ({ PauseDetector: vi.fn(() => ({
  isMeaningfullySilent: () => false, processAudioFrame: () => {}, getCurrentSilenceDurationSeconds: () => 0,
})) }));
vi.mock('../../engines/PrivateSTT', () => ({ createPrivateSTT: () => ({ ...engine, getEngineType: () => 'transformers-js', getMetadata: engine.getMetadata }) }));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.useFakeTimers();
  engine.init.mockResolvedValue(Result.ok('transformers-js'));
  engine.transcribe.mockResolvedValue(Result.ok(''));
  engine.getMetadata.mockReturnValue({ candidateId: 'v2:base.en' });
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks();
  delete window.__PRIVATE_CAPTURE_RECEIPT__;
});

function fakeMic() {
  let listener: ((frame: Float32Array) => void) | undefined;
  const mic: MicStream = { state: 'ready', sampleRate: 16000,
    onFrame: callback => { listener = callback; return () => { listener = undefined; }; }, offFrame: () => {},
    stop: () => {}, close: () => {}, _mediaStream: new MediaStream() };
  return { mic, deliver: (frame: Float32Array) => { if (!listener) throw new Error('real facade listener not installed'); listener(frame); } };
}

it('an ungated page (no internal build, no comparison authorization) publishes no capture receipt', async () => {
  vi.stubEnv('VITE_INTERNAL_BUILD', 'false');
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  const { mic, deliver } = fakeMic();
  try {
    await mode.init(); await mode.start(mic);
    deliver(new Float32Array(128));
    expect(window.__PRIVATE_CAPTURE_RECEIPT__).toBeUndefined();
  } finally { await mode.stop(); }
});

it('an internal build publishes one live receipt per capture that counts real listener deliveries', async () => {
  vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  const { mic, deliver } = fakeMic();
  try {
    await mode.init(); await mode.start(mic);
    const read = window.__PRIVATE_CAPTURE_RECEIPT__;
    if (!read) throw new Error('receipt not published');
    expect(read()).toMatchObject({ active: true, candidateId: 'v2:base.en', sampleRateHz: 16000, receivedFrames: 0, receivedSamples: 0 });
    deliver(new Float32Array(128)); deliver(new Float32Array(256));
    const during = read();
    expect(during).toMatchObject({ active: true, receivedFrames: 2, receivedSamples: 384 });
    expect(during.captureId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(during)).not.toMatch(/audio|text|transcript/i);
    await mode.stop();
    // The spec re-reads the receipt after save: still readable, same capture, no longer counting.
    const after = window.__PRIVATE_CAPTURE_RECEIPT__?.();
    expect(after).toMatchObject({ captureId: during.captureId, active: false, receivedFrames: 2 });
  } finally { await mode.stop(); }
});

it('a successor capture gets a new receipt and the retired one stops counting', async () => {
  vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  const first = fakeMic(), second = fakeMic();
  try {
    await mode.init(); await mode.start(first.mic);
    first.deliver(new Float32Array(128));
    const firstRead = window.__PRIVATE_CAPTURE_RECEIPT__!;
    const firstId = firstRead().captureId;
    await mode.stop();
    await mode.start(second.mic);
    second.deliver(new Float32Array(64));
    const current = window.__PRIVATE_CAPTURE_RECEIPT__!();
    expect(current.captureId).not.toBe(firstId);
    expect(current).toMatchObject({ active: true, receivedFrames: 1, receivedSamples: 64 });
    expect(firstRead()).toMatchObject({ captureId: firstId, active: false, receivedFrames: 1, receivedSamples: 128 });
  } finally { await mode.stop(); }
});

it('an identity lookup that throws never stops the recording; the receipt records the candidate as unknown', async () => {
  vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
  engine.getMetadata.mockImplementation(() => { throw new Error('metadata unavailable'); });
  const mode = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
  const { mic, deliver } = fakeMic();
  try {
    await mode.init(); await mode.start(mic);
    deliver(new Float32Array(128));
    expect(window.__PRIVATE_CAPTURE_RECEIPT__?.()).toMatchObject({ active: true, candidateId: null, receivedFrames: 1 });
  } finally { await mode.stop(); }
});
