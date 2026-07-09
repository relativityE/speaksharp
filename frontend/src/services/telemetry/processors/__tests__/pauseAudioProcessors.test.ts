import { describe, it, expect } from 'vitest';
import { PauseProcessor } from '../PauseProcessor';
import { AudioQualityProcessor } from '../AudioQualityProcessor';
import { PaceProcessor } from '../PaceProcessor';
import { PauseDetector } from '@/services/audio/pauseDetector';
import { InMemoryTelemetryBus } from '../../TelemetryBus';
import { MetricsEngine } from '../../MetricsEngine';
import type { TelemetryEvent } from '../../contracts';

// A constant-amplitude frame: rms === amp, peak === |amp|.
const frame = (amp: number, len = 320): Float32Array => Float32Array.from({ length: len }, () => amp);
const audio = (amp: number, t: number): TelemetryEvent =>
  ({ type: 'audio.frame', mode: 'private', t, sampleRate: 16000, frame: frame(amp) });
const fin = (text: string, t: number, seq: number): TelemetryEvent =>
  ({ type: 'transcript.final', mode: 'private', t, text, sequence: seq, replacesRollingTranscript: true });

// LOUD > SILENCE_THRESHOLD (0.01); QUIET < it.
const LOUD = 0.1;
const QUIET = 0;

describe('Phase 5.4 — PauseProcessor (shadow, parity with PauseDetector)', () => {
  const stream: Array<[number, number]> = [
    [LOUD, 0], [QUIET, 100], [QUIET, 300], [LOUD, 800], // 700ms silence gap → 1 pause
    [QUIET, 900], [LOUD, 2000],                         // 1100ms silence gap → 2nd pause
  ];

  it('produces byte-identical metrics to a directly-driven PauseDetector', () => {
    const p = new PauseProcessor();
    const ref = new PauseDetector(undefined, undefined, stream[0][1]);
    let lastT = 0;
    for (const [amp, t] of stream) {
      p.onEvent(audio(amp, t));
      ref.processAudioFrame(frame(amp), t);
      lastT = t;
    }
    expect(p.getSnapshot().delivery!.pauseMetrics).toEqual(ref.getMetrics(lastT));
  });

  it('detects the two >500ms silence gaps', () => {
    const p = new PauseProcessor();
    for (const [amp, t] of stream) p.onEvent(audio(amp, t));
    expect(p.getSnapshot().delivery!.pauseMetrics!.totalPauses).toBe(2);
  });

  it('ignores non-audio events (Native has no audio.frame) → empty patch', () => {
    const p = new PauseProcessor();
    p.onEvent(fin('hello world', 0, 0));
    expect(p.getSnapshot()).toEqual({});
  });

  it('reset clears the detector', () => {
    const p = new PauseProcessor();
    for (const [amp, t] of stream) p.onEvent(audio(amp, t));
    p.reset();
    expect(p.getSnapshot()).toEqual({});
  });
});

describe('Phase 5.4 — AudioQualityProcessor (shadow)', () => {
  it('reports rms/peak/micLevel for app-mic frames', () => {
    const p = new AudioQualityProcessor();
    p.onEvent(audio(LOUD, 0));
    p.onEvent(audio(LOUD, 100));
    p.onEvent(audio(LOUD, 200));
    const a = p.getSnapshot().audio!;
    expect(a.rms).toBeCloseTo(LOUD, 6);
    expect(a.peak).toBeCloseTo(LOUD, 6);
    expect(a.micLevel).toBeGreaterThan(0);
    expect(typeof a.noiseWarning).toBe('boolean');
  });

  it('flags clipping after 3 frames at peak >= 0.98', () => {
    const p = new AudioQualityProcessor();
    p.onEvent(audio(0.99, 0));
    p.onEvent(audio(0.99, 100));
    expect(p.getSnapshot().audio!.clipping).toBe(false); // only 2 frames
    p.onEvent(audio(0.99, 200));
    expect(p.getSnapshot().audio!.clipping).toBe(true);  // 3rd frame trips it
  });

  it('flags lowVolume only after 5s of sub-threshold audio', () => {
    const p = new AudioQualityProcessor();
    p.onEvent(audio(0.001, 0));       // starts the low-volume timer at t=0
    expect(p.getSnapshot().audio!.lowVolume).toBe(false);
    // getSnapshot uses the last processed timestamp; feed a frame at t=6000 to advance it.
    p.onEvent(audio(0.001, 6000));
    expect(p.getSnapshot().audio!.lowVolume).toBe(true);
  });

  it('reset clears the analyzer → empty patch', () => {
    const p = new AudioQualityProcessor();
    p.onEvent(audio(LOUD, 0));
    p.reset();
    expect(p.getSnapshot()).toEqual({});
  });
});

describe('Phase 5.4 — engine composition (pace + pause + audio, no clobber)', () => {
  it('transcript-derived and audio-derived slices coexist in one snapshot', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new PaceProcessor(), new PauseProcessor(), new AudioQualityProcessor()], 's1', 'private');
    bus.publish(fin('one two three four five six seven eight', 0, 0));
    bus.publish(audio(LOUD, 0));
    bus.publish(audio(QUIET, 100));
    bus.publish(audio(LOUD, 800));
    bus.publish(fin('one two three four five six seven eight nine ten', 30_000, 1));
    const snap = engine.getSnapshot();
    expect(snap.delivery.wpm).toBeGreaterThan(0);           // Pace
    expect(snap.delivery.pauseMetrics!.totalPauses).toBe(1); // Pause — did not clobber wpm
    expect(snap.audio!.rms).toBeGreaterThan(0);              // AudioQuality
    engine.dispose();
  });
});
