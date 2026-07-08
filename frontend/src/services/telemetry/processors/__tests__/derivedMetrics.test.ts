import { describe, it, expect } from 'vitest';
import { SessionProcessor } from '../SessionProcessor';
import { PaceProcessor } from '../PaceProcessor';
import { ClarityProcessor } from '../ClarityProcessor';
import { ScoreProcessor } from '../ScoreProcessor';
import { TranscriptProcessor } from '../TranscriptProcessor';
import { FillerProcessor } from '../FillerProcessor';
import { InMemoryTelemetryBus } from '../../TelemetryBus';
import { MetricsEngine } from '../../MetricsEngine';
import { createEmptyMetricsSnapshot } from '../../metricsSnapshot';
import { calculateClarityScore, calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';
import type { TelemetryEvent } from '../../contracts';

const fin = (text: string, t: number, seq: number): TelemetryEvent =>
  ({ type: 'transcript.final', mode: 'private', t, text, sequence: seq, replacesRollingTranscript: true });
const tick = (elapsedSeconds: number, t: number): TelemetryEvent =>
  ({ type: 'session.tick', mode: 'private', t, elapsedSeconds });

describe('Phase 5.5 — SessionProcessor + Pace elapsed basis', () => {
  it('SessionProcessor emits elapsedSeconds only after a tick', () => {
    const s = new SessionProcessor();
    expect(s.getSnapshot()).toEqual({});
    s.onEvent(tick(42, 0));
    expect(s.getSnapshot()).toEqual({ elapsedSeconds: 42 });
    s.reset();
    expect(s.getSnapshot()).toEqual({});
  });

  it('PaceProcessor computes wpm from the tick elapsedSeconds (authoritative basis)', () => {
    const p = new PaceProcessor();
    p.onEvent(fin('one two three four five six seven eight nine ten', 0, 0)); // 10 words
    p.onEvent(tick(60, 100)); // 60s → 10 wpm
    expect(p.getSnapshot().delivery!.wpm).toBe(10);
  });
});

describe('Phase 5.5 — ClarityProcessor (tier-2, parity with calculateClarityScore)', () => {
  it('derives clarityScore byte-identically from the base snapshot', () => {
    const base = createEmptyMetricsSnapshot('s', 'private');
    base.transcript.finalText = 'a b c d e f g h i j k l';
    base.transcript.finalWordCount = 12;
    base.delivery.fillerCount = 2;
    base.delivery.wpm = 140;
    expect(new ClarityProcessor().derive(base).delivery!.clarityScore)
      .toBe(calculateClarityScore({ wordCount: 12, fillerCount: 2, errorCount: 0, wpm: 140 }));
  });

  it('yields 0 below the reliable-scoring word floor (matches isClarityScorable gate)', () => {
    const base = createEmptyMetricsSnapshot('s', 'private');
    base.transcript.finalText = 'a b';
    base.transcript.finalWordCount = 2;
    expect(new ClarityProcessor().derive(base).delivery!.clarityScore).toBe(0);
  });
});

describe('Phase 5.5 — ScoreProcessor (tier-2, parity with calculateSpeakingScore)', () => {
  it('maps the pure score result into the snapshot score section', () => {
    const base = createEmptyMetricsSnapshot('s', 'private');
    base.transcript.finalText = 'this is a clear and reasonably long spoken sample about the quarterly plan and the ask';
    base.transcript.finalWordCount = 15;
    base.delivery.wpm = 135;
    base.delivery.clarityScore = 88;
    base.delivery.fillerCount = 1;
    base.elapsedSeconds = 40;
    const ref = calculateSpeakingScore({
      transcript: base.transcript.finalText, wordCount: 15, wpm: 135, clarityScore: 88,
      fillerCount: 1, elapsedSeconds: 40, pauseMetrics: undefined, engine: 'private',
    });
    const patch = new ScoreProcessor().derive(base).score!;
    expect(patch.value).toBe(ref.score);
    expect(patch.label).toBe(ref.label);
    expect(patch.confidence).toBe(ref.confidence);
    expect(patch.breakdown).toEqual(ref.breakdown);
    expect(patch.qualityNote).toBe(ref.qualityNote);
  });
});

describe('Phase 5.5 — FULL PIPELINE parity (events → snapshot == legacy metrics + score)', () => {
  it('reproduces wpm/filler/clarity/score byte-identically from the event stream', () => {
    const transcript = 'um so basically the point here is that it works fine now you know and it is really good today';
    const elapsed = 30;

    // Legacy reference: the deterministic transcript path (fillerData undefined → countFillerWords).
    const core = calculateCoreSessionMetrics({ transcript, durationSeconds: elapsed, fillerData: undefined });
    const refScore = calculateSpeakingScore({
      transcript, wordCount: core.wordCount, wpm: core.wpm, clarityScore: core.clarityScore,
      fillerCount: core.fillerCount, elapsedSeconds: elapsed, pauseMetrics: undefined, engine: 'private',
    });

    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(
      bus,
      [new TranscriptProcessor(), new FillerProcessor(), new PaceProcessor(), new SessionProcessor()],
      's1', 'private',
      [new ClarityProcessor(), new ScoreProcessor()],
    );
    bus.publish(fin(transcript, 0, 0));
    bus.publish(tick(elapsed, 1));
    const snap = engine.getSnapshot();

    expect(snap.transcript.finalWordCount).toBe(core.wordCount);
    expect(snap.delivery.wpm).toBe(core.wpm);
    expect(snap.delivery.fillerCount).toBe(core.fillerCount);
    expect(snap.delivery.clarityScore).toBe(core.clarityScore);
    expect(snap.score.value).toBe(refScore.score);
    expect(snap.score.label).toBe(refScore.label);
    expect(snap.score.confidence).toBe(refScore.confidence);
    expect(snap.score.breakdown).toEqual(refScore.breakdown);
    engine.dispose();
  });
});
