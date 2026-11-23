/**
 * @file PrivateWhisper.liveTailFixture.test.ts
 * @description J3.b live-run finding (rc-gates 45144884602, release 04c2820b): on the committed partial Focus Points
 * fixture, points 1 and 2 changed live ~2 s after they were spoken, but point 3 (the last spoken sentence, audio
 * 16.36–20.57 s, followed by ~15 s of silence) changed only at Stop. The matcher scores that sentence `partial`
 * (tests/unit/rwtPartialFixtureMatcher.test.ts), so the question is whether the Private gate ever sends that sentence to
 * the model before Stop.
 *
 * This replays the REAL fixture WAV through the REAL PrivateWhisper gate and the REAL PauseDetector at real-time cadence
 * (fake timers, 1024-sample frames), with only the model stubbed. Contract: audio that ends at the point-3 window end is
 * sent for transcription within 5 s of it (the live-marker bound), before Stop.
 *
 * Result (2026-11-23): PASSES on 04c2820b. The gate sends a 3 s sliding window about every second through the tail
 * (21.25 s, 22.25 s, 23.5 s, …), so the gate's low-energy deferral is NOT why point 3 changed only at Stop. The cause is
 * downstream of the gate (the real model's live output for those windows, or the live transcript merge); this test
 * guards the gate half so a later fix there cannot regress it.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

vi.unmock('../PrivateWhisper');
import PrivateWhisper from '../PrivateWhisper';
import { Result } from '../types';
import { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO } from '../../sttConstants';
import { decodeWavToFloat32, framesFromSamples } from './helpers/wav';

vi.mock('@xenova/transformers', () => ({}));

const mocks = vi.hoisted(() => ({ init: vi.fn(), checkAvailability: vi.fn(), transcribe: vi.fn(), engineStart: vi.fn(), engineStop: vi.fn() }));
vi.mock('../../engines/PrivateSTT', () => {
  const MockPrivateSTT = vi.fn().mockImplementation(() => ({
    init: mocks.init, checkAvailability: mocks.checkAvailability, transcribe: mocks.transcribe,
    start: mocks.engineStart, stop: mocks.engineStop,
    getMetadata: vi.fn().mockReturnValue({ candidateId: 'v2:base.en', engineVersion: 'private_v2', modelName: 'base.en', deviceType: 'browser' }),
    getEngineType: vi.fn().mockReturnValue('transformers-js'),
  }));
  return { PrivateSTT: MockPrivateSTT, createPrivateSTT: vi.fn(() => new MockPrivateSTT()) };
});

function resolveFixture(): string {
  const rel = 'tests/fixtures/rwt/focus_points_partial_tts.wav';
  for (const base of [process.cwd(), path.resolve(process.cwd(), '..')]) {
    const p = path.resolve(base, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`partial Focus Points fixture not found (cwd=${process.cwd()})`);
}

/** The manifest's pinned point-3 window (tests/fixtures/rwt/rwt-fixtures.manifest.json, pointAudioWindows[2]). */
const POINT3_END_SEC = 20.57;
const LIVE_BOUND_SEC = 5;
const FRAME = 1024;

type Call = { atSec: number; samples: number };
type Timeline = { event: string; perfMs: number; payload?: Record<string, unknown> };

describe('J3.b live tail (gate): the last spoken sentence before a long silence reaches the model before Stop', () => {
  let pw: PrivateWhisper;
  let frameCb: ((f: Float32Array) => void) | undefined;
  let startMs = 0;
  const calls: Call[] = [];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    Object.values(mocks).forEach((m) => m.mockReset());
    calls.length = 0;
    (window as unknown as { __PRIVATE_TRANSCRIPT_TRACE__?: boolean }).__PRIVATE_TRANSCRIPT_TRACE__ = true;
    (window as unknown as { __PRIVATE_STT_TIMELINE__?: Timeline[] }).__PRIVATE_STT_TIMELINE__ = [];
    mocks.init.mockResolvedValue(Result.ok('transformers-js'));
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, reason: 'CACHE_HIT', message: 'ready' });
    mocks.transcribe.mockImplementation(async (audio: unknown) => {
      calls.push({ atSec: (performance.now() - startMs) / 1000, samples: audio instanceof Float32Array ? audio.length : -1 });
      return Result.ok(`words ${calls.length}`);
    });
    pw = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onModelLoadProgress: vi.fn(), onReady: vi.fn(), onStatusChange: vi.fn() });
    await pw.init();
    const mic: MicStream = {
      state: 'ready', sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
      onFrame: vi.fn((cb: (f: Float32Array) => void) => { frameCb = cb; return () => {}; }),
      offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(), _mediaStream: new MediaStream(),
    };
    await pw.start(mic);
    if (!frameCb) throw new Error('mic frame callback was not registered');
    startMs = performance.now();
  });

  afterEach(() => { vi.useRealTimers(); });

  it('sends audio ending at the point-3 window end within 5 s, before Stop', async () => {
    const buf = readFileSync(resolveFixture());
    const { samples, sampleRate } = decodeWavToFloat32(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(sampleRate).toBe(PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
    const frameMs = (FRAME / sampleRate) * 1000;
    for (const frame of framesFromSamples(samples, FRAME)) {
      frameCb!(frame);
      await vi.advanceTimersByTimeAsync(frameMs);
    }
    const beforeStop = [...calls];
    const timeline = ((window as unknown as { __PRIVATE_STT_TIMELINE__?: Timeline[] }).__PRIVATE_STT_TIMELINE__ ?? [])
      .map((t) => ({ event: t.event, atSec: Number(((t.perfMs - startMs) / 1000).toFixed(2)) }))
      .filter((t) => t.atSec >= 16 && /deferred|drop|decision/.test(t.event));
    await pw.stop();

    const covering = beforeStop.filter((c) => c.atSec >= POINT3_END_SEC && c.atSec <= POINT3_END_SEC + LIVE_BOUND_SEC);
    expect(covering.length, `pre-Stop model calls ${JSON.stringify(beforeStop)}; gate events after 16 s ${JSON.stringify(timeline.slice(0, 40))}`)
      .toBeGreaterThan(0);
  }, 60_000);

  it('J3.b fix: with a slow model (5 s per decode), the decodes before Stop together cover the whole point-3 window', async () => {
    // Each live decode reads the audio gathered since the previous decode; on the old 3 s cap a 5 s decode dropped the
    // older ~2 s of every pile-up, so parts of point 3 (16.36–20.57 s) were never decoded live (only at Stop).
    const LATENCY_MS = 5000;
    mocks.transcribe.mockImplementation(async (audio: unknown, opts?: { final?: boolean }) => {
      const endSec = (performance.now() - startMs) / 1000;
      const samples = audio instanceof Float32Array ? audio.length : 0;
      if (opts?.final !== true) await new Promise((r) => setTimeout(r, LATENCY_MS));
      calls.push({ atSec: endSec, samples });
      return Result.ok(`words ${calls.length}`);
    });
    const buf = readFileSync(resolveFixture());
    const { samples, sampleRate } = decodeWavToFloat32(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const frameMs = (FRAME / sampleRate) * 1000;
    for (const frame of framesFromSamples(samples, FRAME)) {
      frameCb!(frame);
      await vi.advanceTimersByTimeAsync(frameMs);
    }
    const live = [...calls];
    // Stop drains the in-flight slow decode; the fake clock must move for it to finish.
    const stopping = pw.stop();
    await vi.advanceTimersByTimeAsync(LATENCY_MS * 3);
    await stopping;
    // A decode cut at T holds [T - samples/SR, T]. The union of pre-Stop live windows must cover the point-3 window.
    const windows = live.map((c) => [c.atSec - c.samples / sampleRate, c.atSec] as const).sort((a, b) => a[0] - b[0]);
    const POINT3: readonly [number, number] = [16.36, POINT3_END_SEC];
    let covered = POINT3[0];
    for (const [start, end] of windows) if (start <= covered + 0.05 && end > covered) covered = end;
    expect(covered, `pre-Stop live windows ${JSON.stringify(windows.map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))]))}`)
      .toBeGreaterThanOrEqual(POINT3[1]);
  }, 60_000);
});

