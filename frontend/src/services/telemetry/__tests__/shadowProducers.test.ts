import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSessionTelemetryBus,
  publishTelemetry,
  __resetSessionTelemetryBusForTests,
} from '../sessionTelemetryBus';
import { createShadowMetricsEngine, isShadowMetricsEngineEnabled, toTelemetryMode } from '../shadowMetricsEngine';
import { calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';
import type { TelemetryEvent } from '../contracts';

const frame = (amp: number, len = 320): Float32Array => Float32Array.from({ length: len }, () => amp);

beforeEach(() => __resetSessionTelemetryBusForTests());

describe('Phase 5.6 — shadow engine gate + mode mapping', () => {
  it('shadow engine is ENABLED in test env (returns null / OFF in production)', () => {
    expect(isShadowMetricsEngineEnabled()).toBe(true);
  });

  it('toTelemetryMode maps real engine modes and excludes mock/none/null (Native audio.frame gate is separate)', () => {
    expect(toTelemetryMode('native')).toBe('native');
    expect(toTelemetryMode('private')).toBe('private');
    expect(toTelemetryMode('cloud')).toBe('cloud');
    expect(toTelemetryMode('mock')).toBeNull();
    expect(toTelemetryMode('none')).toBeNull();
    expect(toTelemetryMode(null)).toBeNull();
    expect(toTelemetryMode(undefined)).toBeNull();
  });

  it('createShadowMetricsEngine subscribes one engine; dispose detaches it', () => {
    const before = getSessionTelemetryBus().subscriberCount;
    const engine = createShadowMetricsEngine('s1', 'private');
    expect(engine).not.toBeNull();
    expect(getSessionTelemetryBus().subscriberCount).toBe(before + 1);
    engine!.dispose();
    expect(getSessionTelemetryBus().subscriberCount).toBe(before);
  });
});

describe('Phase 5.6 — each event type published flows to a correct live snapshot', () => {
  it('transcript.final + audio.frame + session.tick drive wpm/filler/clarity/pause/score', () => {
    const engine = createShadowMetricsEngine('s1', 'private')!;
    const transcript = 'um so basically the point here is that it works fine now you know and it is really good today';
    const elapsed = 30;

    // Exactly the events the wired producers emit:
    publishTelemetry({ type: 'transcript.partial', mode: 'private', t: 0, text: 'um so', sequence: 0 });
    publishTelemetry({ type: 'transcript.final', mode: 'private', t: 5, text: transcript, sequence: 1, replacesRollingTranscript: true });
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 0, sampleRate: 16000, frame: frame(0.1) });   // speaking
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 100, sampleRate: 16000, frame: frame(0) });   // silence begins
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 800, sampleRate: 16000, frame: frame(0.1) }); // 700ms gap → 1 pause
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: elapsed });

    const snap = engine.getSnapshot();
    const core = calculateCoreSessionMetrics({ transcript, durationSeconds: elapsed, fillerData: undefined });

    expect(snap.transcript.finalText).toBe(transcript);
    expect(snap.elapsedSeconds).toBe(elapsed);
    expect(snap.delivery.wpm).toBe(core.wpm);
    expect(snap.delivery.fillerCount).toBe(core.fillerCount);
    expect(snap.delivery.clarityScore).toBe(core.clarityScore);
    expect(snap.delivery.pauseMetrics?.totalPauses).toBe(1);

    const refScore = calculateSpeakingScore({
      transcript, wordCount: core.wordCount, wpm: core.wpm, clarityScore: core.clarityScore,
      fillerCount: core.fillerCount, elapsedSeconds: elapsed, pauseMetrics: snap.delivery.pauseMetrics, engine: 'private',
    });
    expect(snap.score.value).toBe(refScore.score);
    engine.dispose();
  });

  it('cloud audio.frame is also consumed (app-mic mode)', () => {
    const engine = createShadowMetricsEngine('s1', 'cloud')!;
    publishTelemetry({ type: 'audio.frame', mode: 'cloud', t: 0, sampleRate: 16000, frame: frame(0.1) });
    expect(engine.getSnapshot().audio?.rms).toBeGreaterThan(0);
    engine.dispose();
  });

  it('audio.frame is type-restricted to private|cloud — Native cannot emit production audio.frame', () => {
    // @ts-expect-error 'native' is not assignable to audio.frame.mode — a compile-time guarantee.
    const nativeAudio: TelemetryEvent = { type: 'audio.frame', mode: 'native', t: 0, sampleRate: 16000, frame: frame(0) };
    expect(nativeAudio.type).toBe('audio.frame');
  });
});
