/**
 * @file PrivateWhisper.cold-start-live.test.ts
 * @description Focus Point 1 on a cold start (Sam/PO 2026-11-16). On a first-run account the mic opens
 * before the Private model has downloaded and loaded (TranscriptionService.init creates the mic stream
 * first, then initializes the engine, ~9 s cold in run 43715342978). The mic replays up to 15 s of the
 * audio it captured meanwhile to the late listener (#960), so the speech spoken while the model was
 * loading reaches PrivateWhisper in one burst when streaming starts.
 *
 * The contract: that opening speech must reach a LIVE decode (and so the live transcript, where Focus
 * marks a point as covered), not only the Stop-time whole-utterance decode. This drives the real
 * PrivateWhisper with no prewarm: the engine is only "ready" when start() subscribes, after the
 * opening was already spoken. It fails while the live path decodes only the newest window of a
 * cold-start backlog, which drops the opening (Point 1) from live transcription.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('../PrivateWhisper');

import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO, PRIV_STT } from '../../sttConstants';

vi.mock('@xenova/transformers', () => ({}));

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  checkAvailability: vi.fn(),
  transcribe: vi.fn(),
  engineStart: vi.fn(),
  engineStop: vi.fn(),
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
    start: mocks.engineStart,
    stop: mocks.engineStop,
    getMetadata: vi.fn().mockReturnValue({ candidateId: 'v2:base.en', engineVersion: 'private_v2', modelName: 'base.en', deviceType: 'browser' }),
    getEngineType: vi.fn().mockReturnValue('transformers-js'),
  }));
  return { PrivateSTT: MockPrivateSTT, createPrivateSTT: vi.fn(() => new MockPrivateSTT()) };
});

const SR = PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ;
const FRAME = Math.round(SR * 0.1); // 100 ms mic frames
// Each spoken point is a distinct amplitude, so the fake decoder can say which point it heard.
const POINT_1 = 0.3;
const POINT_2 = 0.5;
const POINT_1_WORDS = 'my main point is planning';
const POINT_2_WORDS = 'the second point is timing';

function frames(seconds: number, value: number): Float32Array[] {
  return Array.from({ length: Math.round(seconds * 10) }, () => new Float32Array(FRAME).fill(value));
}

function contains(buf: Float32Array, mark: number): boolean {
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i] - mark) <= 0.01) return true;
  return false;
}

/** The PO script's opening, as the mic captured it while the model was still loading: quiet lead-in,
 *  Point 1 at ~2.9-6.2 s, a pause, then Point 2 from ~7 s. About 10 s in all, inside the 15 s replay. */
function coldStartBacklog(): Float32Array[] {
  return [...frames(2.9, 0), ...frames(3.3, POINT_1), ...frames(0.8, 0), ...frames(3.0, POINT_2)];
}

describe('Focus Point 1 on a cold start: speech spoken while the model loads reaches live transcription', () => {
  let pw: PrivateWhisper;
  let liveTexts: string[];
  let stopped: boolean;

  beforeEach(async () => {
    vi.useFakeTimers();
    Object.values(mocks).forEach((m) => 'mockReset' in m && m.mockReset());
    mocks.init.mockResolvedValue(Result.ok('transformers-js'));
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, reason: 'CACHE_HIT', message: 'ready' });
    mocks.isMeaningfullySilent.mockReturnValue(false);
    // A fake decoder: it "hears" each point whose audio is in the window it was handed.
    mocks.transcribe.mockImplementation(async (audio: Float32Array) => {
      const words = [contains(audio, POINT_1) ? POINT_1_WORDS : '', contains(audio, POINT_2) ? POINT_2_WORDS : '']
        .filter(Boolean).join(' ');
      return Result.ok(words);
    });

    liveTexts = [];
    stopped = false;
    const onTranscriptUpdate = vi.fn((update: { transcript: { partial?: string; final?: string } }) => {
      if (stopped) return;
      const text = update.transcript.partial ?? update.transcript.final ?? '';
      if (text) liveTexts.push(text);
    });
    pw = new PrivateWhisper({ onTranscriptUpdate, onModelLoadProgress: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
    await pw.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('decodes Point 1 live when it was spoken before the model finished loading (no prewarm)', async () => {
    const backlog = coldStartBacklog();
    // The real mic (audioUtils.impl.ts) replays its buffered frames synchronously to a late subscriber.
    const mic: MicStream = {
      state: 'ready',
      sampleRate: SR,
      onFrame: vi.fn((cb: (f: Float32Array) => void) => {
        for (const f of backlog) cb(f);
        return () => {};
      }),
      offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(), _mediaStream: new MediaStream(),
    };
    await pw.start(mic);

    // Let live processing run a few ticks, as it would in the seconds after the model is ready.
    await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS * 10);

    const liveDecodes = mocks.transcribe.mock.calls
      .filter((c) => (c[1] as { final?: boolean } | undefined)?.final !== true)
      .map((c) => c[0] as Float32Array);
    const liveTranscript = liveTexts.join(' ');

    console.log('[COLD-START-DIAG]', JSON.stringify({
      backlogSeconds: backlog.length / 10,
      liveDecodeSeconds: liveDecodes.map((a) => Number((a.length / SR).toFixed(2))),
      liveDecodesWithPoint1: liveDecodes.filter((a) => contains(a, POINT_1)).length,
      liveTranscript,
    }));

    expect(liveDecodes.length, 'sanity: live decoding ran once the model was ready').toBeGreaterThan(0);
    expect(liveTranscript, 'sanity: the newest speech (Point 2) is transcribed live').toContain(POINT_2_WORDS);
    // THE CONTRACT: Point 1, spoken while the model was loading, is in the live transcript before Stop.
    expect(liveTranscript, 'Point 1 must be transcribed live, not only at Stop').toContain(POINT_1_WORDS);

    stopped = true;
    await pw.stop();
  });
});
