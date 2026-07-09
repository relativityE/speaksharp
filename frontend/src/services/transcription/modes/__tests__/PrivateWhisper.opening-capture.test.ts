/**
 * @file PrivateWhisper.opening-capture.test.ts
 * @description #891 capture-side proof + regression. Drives the REAL PrivateWhisper speech-start
 * gate with synthetic mic frames (soft opening word -> gap -> body) and inspects the exact audio
 * handed to the final whole-utterance decode (the mocked `transcribe`). If the opening audio is
 * absent from that buffer, the opening clause is dropped at CAPTURE time and the final decode can
 * never recover it. This test asserts the CORRECT behavior (opening retained), so it FAILS on the
 * current capture-gated buffer (proving the root cause) and PASSES once the buffer keeps pre-onset
 * speech. @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('../PrivateWhisper');

import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO, PRIV_STT_DERIVED } from '../../sttConstants';

vi.mock('@xenova/transformers', () => ({}));

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  checkAvailability: vi.fn(),
  transcribe: vi.fn(),
  isMeaningfullySilent: vi.fn().mockReturnValue(false),
  processAudioFrame: vi.fn(),
}));

vi.mock('../../audio/pauseDetector', () => ({
  PauseDetector: vi.fn().mockImplementation(() => ({
    isMeaningfullySilent: mocks.isMeaningfullySilent,
    processAudioFrame: mocks.processAudioFrame,
    getCurrentSilenceDurationSeconds: vi.fn().mockReturnValue(0),
  })),
}));

vi.mock('../../engines/PrivateSTT', () => {
  const MockPrivateSTT = vi.fn().mockImplementation(() => ({
    init: mocks.init,
    checkAvailability: mocks.checkAvailability,
    transcribe: mocks.transcribe,
    getEngineType: vi.fn().mockReturnValue('transformers-js'),
  }));
  return { PrivateSTT: MockPrivateSTT, createPrivateSTT: vi.fn(() => new MockPrivateSTT()) };
});

const OPENING_MARK = 0.3; // amplitude of the "opening" speech segment (distinct, detectable)
const BODY_MARK = 0.5;     // amplitude of the confirming "body" speech

function constFrame(samples: number, value: number): Float32Array {
  return new Float32Array(samples).fill(value);
}

/** Concatenate all Float32Array args across transcribe() calls; the whole-utterance commit passes
 *  the full buffer. Returns the LARGEST single Float32Array argument (the final-decode input). */
function largestTranscribeAudio(): Float32Array | null {
  let best: Float32Array | null = null;
  for (const call of mocks.transcribe.mock.calls) {
    for (const arg of call) {
      if (arg instanceof Float32Array && (!best || arg.length > best.length)) best = arg;
    }
  }
  return best;
}

function containsMark(buf: Float32Array, mark: number, tol = 0.01): boolean {
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i] - mark) <= tol) return true;
  return false;
}

describe('#891 PrivateWhisper opening-clause capture', () => {
  let pw: PrivateWhisper;
  let frameCb: ((f: Float32Array) => void) | undefined;

  beforeEach(async () => {
    Object.values(mocks).forEach((m) => 'mockReset' in m && m.mockReset());
    mocks.init.mockResolvedValue(Result.ok('transformers-js'));
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, reason: 'CACHE_HIT', message: 'ready' });
    mocks.isMeaningfullySilent.mockReturnValue(false);
    mocks.transcribe.mockResolvedValue(Result.ok('decoded'));

    pw = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onModelLoadProgress: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
    await pw.init();
    frameCb = undefined;
    const mic: MicStream = {
      state: 'ready',
      sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
      onFrame: vi.fn((cb: (f: Float32Array) => void) => { frameCb = cb; return () => {}; }),
      offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(), _mediaStream: new MediaStream(),
    };
    await pw.start(mic);
    if (!frameCb) throw new Error('mic frame callback was not registered by start()');
  });

  it('retains the opening speech in the final whole-utterance decode buffer', async () => {
    const min = PRIV_STT_DERIVED.SPEECH_START_MIN_SAMPLES;
    const preroll = PRIV_STT_DERIVED.SPEECH_START_PREROLL_SAMPLES;

    // 1) Opening word: real speech, but shorter than the confirmation threshold (not confirmed yet).
    frameCb!(constFrame(Math.floor(min * 0.5), OPENING_MARK));
    // 2) A natural micro-gap longer than the reset tolerance AND the pre-roll cap, so the demoted
    //    opening candidate is evicted from the 300ms pre-roll before speech confirms.
    frameCb!(constFrame(preroll * 4, 0.0));
    // 3) Body speech long enough to confirm speech-start.
    frameCb!(constFrame(min * 2, BODY_MARK));
    frameCb!(constFrame(min * 2, BODY_MARK));

    await pw.stop();

    const finalAudio = largestTranscribeAudio();
    expect(finalAudio, 'whole-utterance commit must have decoded some audio').toBeTruthy();

    const openingRetained = containsMark(finalAudio!, OPENING_MARK);
    const bodyRetained = containsMark(finalAudio!, BODY_MARK);

    // Diagnostic (printed on failure): classifies capture-side drop with hard numbers.
    console.log('[#891-DIAG]', JSON.stringify({
      finalDecodeSamples: finalAudio!.length,
      openingRetained, bodyRetained,
      speechStartMinSamples: min, prerollCapSamples: preroll,
    }));

    expect(bodyRetained, 'sanity: body speech reached the final decode buffer').toBe(true);
    // THE CONTRACT: the opening speech must survive into the final decode buffer.
    expect(openingRetained, 'opening speech must be present in the whole-utterance decode buffer (capture-side #891)').toBe(true);
  });

  it('trims an implausibly long quiet lead-in (room tone) to avoid leading hallucination', async () => {
    const SR = PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ;
    // 13s of quiet room tone (above the 0.003 floor, below speech) then a loud body. The duration
    // guard (>12s quiet before the first loud frame) trims the lead-in to ~1s so the decoder is not
    // fed 13s of low-energy audio (verified to make Whisper hallucinate a "(crowd murmuring)" prefix).
    for (let i = 0; i < 13; i++) frameCb!(constFrame(SR, 0.004));
    frameCb!(constFrame(SR, 0.2));
    frameCb!(constFrame(SR, 0.2));
    await pw.stop();

    const longAudio = largestTranscribeAudio();
    expect(longAudio, 'whole-utterance commit must have decoded some audio').toBeTruthy();
    const seconds = longAudio!.length / SR;
    expect(seconds, `long room-tone lead-in must be trimmed (got ${seconds.toFixed(1)}s of ~15s)`).toBeLessThan(5);
  });
});
