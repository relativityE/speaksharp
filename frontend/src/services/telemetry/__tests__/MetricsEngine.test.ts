import { describe, it, expect, vi } from 'vitest';
import { InMemoryTelemetryBus } from '../TelemetryBus';
import { MetricsEngine } from '../MetricsEngine';
import { createEmptyMetricsSnapshot, mergeMetricsSnapshot } from '../metricsSnapshot';
import type { MetricProcessor, MetricsSnapshot, TelemetryEvent } from '../contracts';

const finalEvt = (text: string, seq: number): TelemetryEvent => ({
  type: 'transcript.final', mode: 'native', t: 100 + seq, text, sequence: seq, replacesRollingTranscript: true,
});

/** A stub processor that counts finals and contributes a disjoint slice of the snapshot. */
class CountingProcessor implements MetricProcessor {
  readonly name = 'counting';
  private finals = 0;
  onEvent(e: TelemetryEvent): void { if (e.type === 'transcript.final') this.finals += 1; }
  getSnapshot(): Partial<MetricsSnapshot> { return { engine: { resultCount: this.finals, finalCount: this.finals, interimCount: 0, errorCount: 0, restartCount: 0 } }; }
  reset(): void { this.finals = 0; }
}

describe('Phase 5 — MetricsEngine skeleton', () => {
  it('fans bus events to processors and merges their slices into one snapshot', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const proc = new CountingProcessor();
    const spy = vi.spyOn(proc, 'onEvent');
    const engine = new MetricsEngine(bus, [proc], 's1', 'native');

    bus.publish(finalEvt('hello', 0));
    bus.publish(finalEvt('hello world', 1));

    expect(spy).toHaveBeenCalledTimes(2);
    const snap = engine.getSnapshot();
    expect(snap.engine.finalCount).toBe(2);
    expect(snap.sessionId).toBe('s1');
    expect(snap.mode).toBe('native');
    expect(snap.updatedAt).toBe(101); // event.t of the last event
    engine.dispose();
  });

  it('with ZERO processors it is a pure no-op (empty snapshot) — safe to wire in shadow', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [], 's1', 'native');
    bus.publish(finalEvt('anything', 0));
    expect(engine.getSnapshot()).toEqual({ ...createEmptyMetricsSnapshot('s1', 'native'), updatedAt: 100 });
    engine.dispose();
  });

  it('#5.7 mode filter: ignores events from OTHER modes on the shared bus', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const proc = new CountingProcessor();
    const spy = vi.spyOn(proc, 'onEvent');
    const engine = new MetricsEngine(bus, [proc], 's1', 'private'); // a PRIVATE session

    // Cross-mode traffic on the shared bus must be ignored...
    bus.publish(finalEvt('native words', 0)); // mode: 'native'
    bus.publish({ type: 'audio.frame', mode: 'cloud', t: 5, sampleRate: 16000, frame: new Float32Array(4) });
    bus.publish({ type: 'session.tick', mode: 'native', t: 6, elapsedSeconds: 3 });
    expect(spy).not.toHaveBeenCalled();
    expect(engine.getSnapshot().engine.finalCount).toBe(0);

    // ...while this engine's own mode is processed normally.
    bus.publish({ type: 'transcript.final', mode: 'private', t: 7, text: 'mine', sequence: 1, replacesRollingTranscript: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().engine.finalCount).toBe(1);
    engine.dispose();
  });

  it('notifies snapshot subscribers on each recompute', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new CountingProcessor()], 's1', 'native');
    const sub = vi.fn();
    engine.subscribe(sub);
    bus.publish(finalEvt('a', 0));
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0][0].engine.finalCount).toBe(1);
    engine.dispose();
  });

  it('reset re-arms processors and clears the snapshot for a new session', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new CountingProcessor()], 's1', 'native');
    bus.publish(finalEvt('a', 0));
    expect(engine.getSnapshot().engine.finalCount).toBe(1);
    engine.reset('s2', 'private');
    expect(engine.getSnapshot().engine.finalCount).toBe(0);
    expect(engine.getSnapshot().sessionId).toBe('s2');
    expect(engine.getSnapshot().mode).toBe('private');
    engine.dispose();
  });

  it('a throwing processor never breaks the engine or the other processors', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const bad: MetricProcessor = {
      name: 'bad',
      onEvent: () => { throw new Error('boom'); },
      getSnapshot: () => { throw new Error('boom'); },
      reset: () => { throw new Error('boom'); },
    };
    const good = new CountingProcessor();
    const engine = new MetricsEngine(bus, [bad, good], 's1', 'native');
    expect(() => bus.publish(finalEvt('a', 0))).not.toThrow();
    expect(engine.getSnapshot().engine.finalCount).toBe(1); // good processor still contributed
    engine.dispose();
  });

  it('mergeMetricsSnapshot shallow-merges sections without clobbering siblings', () => {
    const base = createEmptyMetricsSnapshot('s1', 'native');
    const merged = mergeMetricsSnapshot(base, { delivery: { wpm: 120, fillerCount: 0, fillerRate: 0, clarityScore: 0 } });
    expect(merged.delivery.wpm).toBe(120);
    expect(merged.transcript.wordCount).toBe(0); // untouched section preserved
  });
});
