import { describe, it, expect, beforeEach } from 'vitest';
import { computeLegacyMetrics, compareSnapshotToLegacy } from '../metricsParity';
import { createShadowMetricsEngine } from '../shadowMetricsEngine';
import { publishTelemetry, __resetSessionTelemetryBusForTests } from '../sessionTelemetryBus';
import { calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
import type { FillerCounts } from '@/utils/fillerWordUtils';

const frame = (amp: number, len = 320): Float32Array => Float32Array.from({ length: len }, () => amp);

beforeEach(() => __resetSessionTelemetryBusForTests());

describe('Phase 5.7 — shadow↔legacy parity instrumentation', () => {
  it('reports allEqual: shadow snapshot == legacy metrics on identical inputs', () => {
    const engine = createShadowMetricsEngine('s1', 'private')!;
    const transcript = 'um so basically the point here is that it works fine now you know and it is really good today';
    const elapsed = 30;
    publishTelemetry({ type: 'transcript.final', mode: 'private', t: 0, text: transcript, sequence: 0, replacesRollingTranscript: true });
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 0, sampleRate: 16000, frame: frame(0.1) });
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 100, sampleRate: 16000, frame: frame(0) });
    publishTelemetry({ type: 'audio.frame', mode: 'private', t: 800, sampleRate: 16000, frame: frame(0.1) });
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: elapsed });

    const snap = engine.getSnapshot();
    const legacy = computeLegacyMetrics({ transcript, elapsedSeconds: elapsed, fillerData: undefined, pauseMetrics: snap.delivery.pauseMetrics, engine: 'private' });
    const report = compareSnapshotToLegacy(snap, legacy);

    expect(report.allEqual).toBe(true);
    expect(report.divergentCount).toBe(0);
    engine.dispose();
  });

  it('DETECTS divergence when the legacy LIVE filler count differs from the transcript recount', () => {
    const engine = createShadowMetricsEngine('s1', 'private')!;
    const transcript = 'um so um basically um the point of the update today';
    const elapsed = 10;
    publishTelemetry({ type: 'transcript.final', mode: 'private', t: 0, text: transcript, sequence: 0, replacesRollingTranscript: true });
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: elapsed });
    const snap = engine.getSnapshot();

    // Legacy LIVE fillerData (useFillerWords) under-counts vs the deterministic transcript recount.
    const liveFillerData: FillerCounts = { total: { count: 1, color: '' }, um: { count: 1, color: '' } };
    const legacy = computeLegacyMetrics({ transcript, elapsedSeconds: elapsed, fillerData: liveFillerData, engine: 'private' });
    const report = compareSnapshotToLegacy(snap, legacy);

    expect(report.allEqual).toBe(false);
    const filler = report.fields.find((f) => f.name === 'fillerCount')!;
    expect(filler.equal).toBe(false);
    expect(filler.shadow).toBeGreaterThan(filler.legacy);
    engine.dispose();
  });

  it('parity report is NUMBERS ONLY — no transcript text leaks (privacy)', () => {
    const engine = createShadowMetricsEngine('s1', 'private')!;
    const transcript = 'the secret plan is to launch on friday afternoon';
    publishTelemetry({ type: 'transcript.final', mode: 'private', t: 0, text: transcript, sequence: 0, replacesRollingTranscript: true });
    publishTelemetry({ type: 'session.tick', mode: 'private', t: 1000, elapsedSeconds: 10 });
    const snap = engine.getSnapshot();
    const legacy = computeLegacyMetrics({ transcript, elapsedSeconds: 10, engine: 'private' });
    const report = compareSnapshotToLegacy(snap, legacy);

    const json = JSON.stringify(report);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('friday');
    expect(report.fields.map((f) => f.name).sort()).toEqual(['clarityScore', 'fillerCount', 'scoreValue', 'wordCount', 'wpm']);
    engine.dispose();
  });

  it('computeLegacyMetrics matches calculateCoreSessionMetrics for the same inputs', () => {
    const transcript = 'hello world this is a test of the pace and clarity computation over a short window';
    const core = calculateCoreSessionMetrics({ transcript, durationSeconds: 20, fillerData: undefined });
    const legacy = computeLegacyMetrics({ transcript, elapsedSeconds: 20, fillerData: undefined });
    expect(legacy.wordCount).toBe(core.wordCount);
    expect(legacy.wpm).toBe(core.wpm);
    expect(legacy.fillerCount).toBe(core.fillerCount);
    expect(legacy.clarityScore).toBe(core.clarityScore);
  });
});
