import { describe, it, expect, beforeEach } from 'vitest';
import { createShadowMetricsEngine } from '../shadowMetricsEngine';
import { publishTelemetry, __resetSessionTelemetryBusForTests } from '../sessionTelemetryBus';
import { InMemoryTelemetryBus } from '../TelemetryBus';
import { MetricsEngine } from '../MetricsEngine';
import { computeLegacyMetrics } from '../metricsParity';
import { appendCommittedFinal } from '../processors/textMetrics';
import { PauseProcessor } from '../processors/PauseProcessor';
import { TranscriptProcessor } from '../processors/TranscriptProcessor';
import { PauseDetector } from '@/services/audio/pauseDetector';
import type { TelemetryEvent } from '../contracts';

const frame = (amp: number, len = 320): Float32Array => Float32Array.from({ length: len }, () => amp);
const fin = (text: string, t: number, seq: number, replaces = true): TelemetryEvent =>
  ({ type: 'transcript.final', mode: 'private', t, text, sequence: seq, replacesRollingTranscript: replaces });
const audio = (amp: number, t: number): TelemetryEvent =>
  ({ type: 'audio.frame', mode: 'private', t, sampleRate: 16000, frame: frame(amp) });

beforeEach(() => __resetSessionTelemetryBusForTests());

describe('#5.7 Risk 1 — early events captured before the DB session id arrives', () => {
  it('engine created with a provisional id captures events, then rebinds the real id without resetting', () => {
    // Engine stands up EARLY with a provisional id (as the controller now does before startTranscription).
    const engine = createShadowMetricsEngine('provisional-recording-id', 'private')!;

    // Events fire BEFORE the async DB save would complete.
    publishTelemetry(fin('early committed words here', 0, 0));
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: 5 });

    // DB id arrives → rebind WITHOUT reset.
    engine.setSessionId('real-db-session-id');
    const snap = engine.getSnapshot();

    expect(snap.transcript.finalText).toBe('early committed words here'); // early event NOT lost
    expect(snap.sessionId).toBe('real-db-session-id');                    // id rebound
    expect(snap.elapsedSeconds).toBe(5);
    engine.dispose();
  });
});

describe('#5.7 Risk 7 — requested mode differs from the actual negotiated/fallback mode', () => {
  it('provisional engine captures early fallback-mode events, then binds to the actual mode (filter preserved)', () => {
    // Requested/preferred mode was 'private', but the session actually negotiated / fell back to 'native'.
    // The shadow engine is created PROVISIONAL, so it captures the native events instead of dropping them.
    const engine = createShadowMetricsEngine('provisional-id', 'private')!;

    // Early NATIVE events fire before the DB-id / actual-mode bind. (Under preferred-mode-only filtering
    // these would be dropped — see the regression test below.)
    publishTelemetry({ type: 'transcript.final', mode: 'native', t: 0, text: 'the native fallback transcript', sequence: 0, replacesRollingTranscript: true });
    publishTelemetry({ type: 'session.tick', mode: 'native', t: 1000, elapsedSeconds: 5 });
    expect(engine.getSnapshot().transcript.finalText).toBe('the native fallback transcript');

    // Actual mode confirmed → bind it (activates filtering on the REAL mode) + rebind the real id.
    engine.setSessionId('real-db-id');
    engine.bindMode('native');
    expect(engine.getSnapshot().mode).toBe('native');

    // After binding, cross-mode events are dropped — the #6 filter is preserved.
    publishTelemetry({ type: 'transcript.final', mode: 'cloud', t: 2000, text: 'from another session', sequence: 1, replacesRollingTranscript: true });
    expect(engine.getSnapshot().transcript.finalText).toBe('the native fallback transcript');
    engine.dispose();
  });

  it('REGRESSION: a mode-bound engine (old preferred-only behavior) DROPS fallback-mode events', () => {
    // Documents exactly the bug this fix addresses: binding to the requested mode up-front loses the
    // actual session's events when negotiation/fallback picked a different mode.
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new TranscriptProcessor()], 's1', 'private', [], true); // bound to preferred
    bus.publish({ type: 'transcript.final', mode: 'native', t: 0, text: 'lost', sequence: 0, replacesRollingTranscript: true });
    expect(engine.getSnapshot().transcript.finalText).toBe(''); // dropped by the preferred-mode filter
    engine.dispose();
  });
});

describe('#5.7 Risk 3 — custom filler words counted by both snapshot and legacy', () => {
  it('a custom filler ("honestly") is counted in the snapshot and computeLegacyMetrics agrees', () => {
    const userWords = ['honestly'];
    const transcript = 'honestly this is honestly a solid update on the plan today for the team';
    const engine = createShadowMetricsEngine('s1', 'private', { userWords })!;
    publishTelemetry(fin(transcript, 0, 0));
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: 10 });
    const snap = engine.getSnapshot();

    const withWords = computeLegacyMetrics({ transcript, elapsedSeconds: 10, userWords, engine: 'private' });
    const withoutWords = computeLegacyMetrics({ transcript, elapsedSeconds: 10, userWords: [], engine: 'private' });

    expect(withWords.fillerCount).toBeGreaterThan(withoutWords.fillerCount); // "honestly" adds ≥2
    expect(snap.delivery.fillerCount).toBe(withWords.fillerCount);           // snapshot honors userWords
    engine.dispose();
  });
});

describe('#5.7 Risk 4 — pause timing anchored to session start, not the first frame', () => {
  it('a delayed first frame does not inflate pause metrics (matches a session-anchored detector)', () => {
    const sessionStartT = 0;
    const firstFrameDelay = 5000; // 5s mic warm-up before the first frame

    const anchored = new PauseProcessor(sessionStartT);
    const ref = new PauseDetector(undefined, undefined, sessionStartT); // legacy: detector built at session start

    const stream: Array<[number, number]> = [
      [0.1, firstFrameDelay], [0, firstFrameDelay + 100], [0.1, firstFrameDelay + 800], // 700ms gap → 1 pause
    ];
    let lastT = 0;
    for (const [amp, t] of stream) {
      anchored.onEvent(audio(amp, t));
      ref.processAudioFrame(frame(amp), t);
      lastT = t;
    }
    // Session-anchored shadow == legacy anchored at session start (window includes the warm-up gap).
    expect(anchored.getSnapshot().delivery!.pauseMetrics).toEqual(ref.getMetrics(lastT));

    // And it must NOT match a first-frame-anchored detector, which would shrink the window and inflate rates.
    const firstFrameAnchored = new PauseDetector(undefined, undefined, firstFrameDelay);
    for (const [amp, t] of stream) firstFrameAnchored.processAudioFrame(frame(amp), t);
    expect(anchored.getSnapshot().delivery!.pauseMetrics!.pausesPerMinute)
      .toBeLessThan(firstFrameAnchored.getMetrics(lastT).pausesPerMinute);
  });
});

describe('#5.7 Risk 5 — blank replacing final does not wipe committed transcript', () => {
  it('appendCommittedFinal preserves prior text on a blank/whitespace replacing final', () => {
    expect(appendCommittedFinal('hello world', '   ', true)).toBe('hello world');
    expect(appendCommittedFinal('hello world', '', true)).toBe('hello world');
    expect(appendCommittedFinal('hello world', 'fresh text', true)).toBe('fresh text');
  });

  it('TranscriptProcessor (via engine) keeps committed text when a blank authoritative final arrives', () => {
    const engine = createShadowMetricsEngine('s1', 'private')!;
    publishTelemetry(fin('the committed transcript', 0, 0, true));
    publishTelemetry(fin('   ', 1, 1, true)); // blank authoritative final
    expect(engine.getSnapshot().transcript.finalText).toBe('the committed transcript');
    engine.dispose();
  });
});
