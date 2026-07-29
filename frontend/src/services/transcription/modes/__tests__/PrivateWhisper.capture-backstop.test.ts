/**
 * @file PrivateWhisper.capture-backstop.test.ts
 * @description #1089 data-integrity proof. Drives the REAL PrivateWhisper capture path past the hard
 * memory backstop (MAX_UTTERANCE_SAMPLES) with synthetic mic frames.
 *
 * The defect this locks out: on reaching the backstop the engine returned SILENTLY. It stopped
 * accumulating audio while the recording stayed live and the UI kept showing "Recording", so
 * everything the user said past that point was discarded with no error and no telemetry.
 *
 * The contract asserted here:
 *   1. The engine signals ONCE (`onCaptureLimitReached`) so the app can perform a controlled stop.
 *   2. Every sample captured BEFORE the guard is still handed to the final whole-utterance decode —
 *      hitting the backstop must never cost the user the audio they already recorded.
 *
 * @vitest-environment happy-dom
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

const EARLY_MARK = 0.42; // amplitude of the audio captured well BEFORE the backstop
const SR = PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ;

function constFrame(samples: number, value: number): Float32Array {
  return new Float32Array(samples).fill(value);
}

/** The whole-utterance commit passes the full buffer; take the largest Float32Array argument. */
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

describe('#1089 PrivateWhisper capture backstop', () => {
  let pw: PrivateWhisper;
  let frameCb: ((f: Float32Array) => void) | undefined;
  let onCaptureLimitReached: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    Object.values(mocks).forEach((m) => 'mockReset' in m && m.mockReset());
    mocks.init.mockResolvedValue(Result.ok('transformers-js'));
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, reason: 'CACHE_HIT', message: 'ready' });
    mocks.isMeaningfullySilent.mockReturnValue(false);
    mocks.transcribe.mockResolvedValue(Result.ok('decoded'));

    onCaptureLimitReached = vi.fn();
    pw = new PrivateWhisper({
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      onStatusChange: vi.fn(),
      onCaptureLimitReached,
    });
    await pw.init();
    frameCb = undefined;
    const mic: MicStream = {
      state: 'ready',
      sampleRate: SR,
      onFrame: vi.fn((cb: (f: Float32Array) => void) => { frameCb = cb; return () => {}; }),
      offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(), _mediaStream: new MediaStream(),
    };
    await pw.start(mic);
    if (!frameCb) throw new Error('mic frame callback was not registered by start()');
  });

  /** Fill the buffer to `samples` using 1-second frames, then push `overrunFrames` more. */
  function driveTo(samples: number, mark: number, overrunFrames: number): void {
    const wholeSeconds = Math.floor(samples / SR);
    for (let i = 0; i < wholeSeconds; i++) frameCb!(constFrame(SR, mark));
    const remainder = samples - wholeSeconds * SR;
    if (remainder > 0) frameCb!(constFrame(remainder, mark));
    for (let i = 0; i < overrunFrames; i++) frameCb!(constFrame(SR, mark));
  }

  it('signals the app exactly once instead of silently discarding audio', async () => {
    driveTo(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES, EARLY_MARK, 5);

    expect(
      onCaptureLimitReached,
      'reaching the backstop must tell the app to stop — silence here is the data-integrity defect',
    ).toHaveBeenCalledTimes(1);

    const info = onCaptureLimitReached.mock.calls[0][0];
    expect(info.limitSeconds).toBe(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES / SR);
    // Durations only — the signal must never carry transcript, audio or identity.
    expect(Object.keys(info).sort()).toEqual(['bufferedSeconds', 'limitSeconds']);
    expect(info.bufferedSeconds).toBeGreaterThan(0);
  });

  it('preserves every sample captured BEFORE the guard for the final decode', async () => {
    driveTo(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES, EARLY_MARK, 3);
    await pw.stop();

    const finalAudio = largestTranscribeAudio();
    expect(finalAudio, 'the whole-utterance commit must still decode what was captured').toBeTruthy();
    expect(
      containsMark(finalAudio!, EARLY_MARK),
      'audio recorded before the backstop must survive into the final decode buffer',
    ).toBe(true);
    // The buffer is bounded by the backstop, but must not be empty or truncated to a token amount.
    expect(finalAudio!.length).toBeGreaterThan(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES * 0.5);
    expect(finalAudio!.length).toBeLessThanOrEqual(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES);
  });
});
