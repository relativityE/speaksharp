/**
 * @file PrivateWhisper.softonset-fixture.test.ts
 * @description #891 REAL-AUDIO soft-onset regression. Replays a real-voice fixture
 * (softonset_my_main_point_16k.wav — the captured 7:16 take with the "My main point…" opening
 * attenuated below the speech-start threshold) through the REAL PrivateWhisper gate and asserts the
 * final whole-utterance decode buffer retains (nearly) the whole recording, including the soft
 * opening.
 *
 * Acceptance contract (release-owner): on old/main the buffer is seeded from the bounded speech-start
 * buffers at delayed confirmation and clips the front; with capture-from-start the final buffer
 * accumulates from mic-start so the opening survives. The SAME fixture proves both.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

vi.unmock('../PrivateWhisper');
import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO } from '../../sttConstants';
import { decodeWavToFloat32, framesFromSamples } from './helpers/wav';

vi.mock('@xenova/transformers', () => ({}));

const mocks = vi.hoisted(() => ({
  init: vi.fn(), checkAvailability: vi.fn(), transcribe: vi.fn(),
  isMeaningfullySilent: vi.fn().mockReturnValue(false), processAudioFrame: vi.fn(),
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
    init: mocks.init, checkAvailability: mocks.checkAvailability, transcribe: mocks.transcribe,
    getEngineType: vi.fn().mockReturnValue('transformers-js'),
  }));
  return { PrivateSTT: MockPrivateSTT, createPrivateSTT: vi.fn(() => new MockPrivateSTT()) };
});

function resolveFixture(): string {
  const rel = 'tests/fixtures/softonset_my_main_point_16k.wav';
  for (const base of [process.cwd(), path.resolve(process.cwd(), '..')]) {
    const p = path.resolve(base, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`soft-onset fixture not found (cwd=${process.cwd()})`);
}
const FIXTURE = resolveFixture();

function largestTranscribeAudio(): Float32Array | null {
  let best: Float32Array | null = null;
  for (const call of mocks.transcribe.mock.calls)
    for (const arg of call) if (arg instanceof Float32Array && (!best || arg.length > best.length)) best = arg;
  return best;
}

describe('#891 real-audio soft-onset capture (fixture)', () => {
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
      state: 'ready', sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
      onFrame: vi.fn((cb: (f: Float32Array) => void) => { frameCb = cb; return () => {}; }),
      offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(), _mediaStream: new MediaStream(),
    };
    await pw.start(mic);
    if (!frameCb) throw new Error('mic frame callback was not registered');
  });

  it('retains the full recording incl. the soft opening in the final decode buffer', async () => {
    const buf = readFileSync(FIXTURE);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { samples } = decodeWavToFloat32(ab);
    for (const frame of framesFromSamples(samples, 1024)) frameCb!(frame);
    await pw.stop();

    const finalAudio = largestTranscribeAudio();
    expect(finalAudio, 'whole-utterance commit must have decoded some audio').toBeTruthy();

    // Capture-from-start contract: old/main seeds the final buffer from the bounded gate buffers at a
    // delayed speech-start and clips the soft opening off the FRONT; the fix accumulates from
    // mic-start, so the buffer retains (nearly) the whole recording. Only true leading/trailing pure
    // silence may be trimmed, and this fixture's lead-in is above the trim floor — so ~full retention.
    const retainedRatio = finalAudio!.length / samples.length;
    expect(
      retainedRatio,
      `final-decode buffer must retain the full recording incl. the soft opening (got ${(retainedRatio * 100).toFixed(1)}% of ${samples.length} samples)`,
    ).toBeGreaterThanOrEqual(0.97);
  });
});
