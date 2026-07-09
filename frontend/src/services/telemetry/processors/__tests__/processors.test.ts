import { describe, it, expect } from 'vitest';
import { TranscriptProcessor } from '../TranscriptProcessor';
import { NativeLifecycleProcessor } from '../NativeLifecycleProcessor';
import { InMemoryTelemetryBus } from '../../TelemetryBus';
import { MetricsEngine } from '../../MetricsEngine';
import type { TelemetryEvent } from '../../contracts';

const fin = (text: string, t: number, seq: number): TelemetryEvent =>
  ({ type: 'transcript.final', mode: 'native', t, text, sequence: seq, replacesRollingTranscript: true });
const par = (text: string, t: number, seq: number): TelemetryEvent =>
  ({ type: 'transcript.partial', mode: 'native', t, text, sequence: seq });
const life = (event: 'start' | 'speechStart' | 'end', t: number): TelemetryEvent =>
  ({ type: 'webspeech.lifecycle', mode: 'native', t, event });

describe('Phase 5.2 — TranscriptProcessor', () => {
  it('accumulates the rolling final (replacesRollingTranscript), clears interim on final, counts words', () => {
    const p = new TranscriptProcessor();
    p.onEvent(par('hello wor', 1, 0));
    p.onEvent(fin('hello world.', 2, 1));               // final supersedes interim
    p.onEvent(par('this is a pending', 3, 2));
    const s = p.getSnapshot().transcript!;
    expect(s.finalText).toBe('hello world.');
    expect(s.interimText).toBe('this is a pending');
    expect(s.finalWordCount).toBe(2);
    expect(s.partialWordCount).toBe(4);
    expect(s.wordCount).toBe(6);
    expect(s.trusted).toBe(true);
  });

  it('maxRunOnWords = longest unpunctuated run; confidence scales with committed words', () => {
    const p = new TranscriptProcessor();
    p.onEvent(fin('one two three. four five six seven eight', 1, 0));
    const s = p.getSnapshot().transcript!;
    expect(s.maxRunOnWords).toBe(5); // "four five six seven eight"
    expect(s.confidence).toBe('medium'); // 8 committed words
    const empty = new TranscriptProcessor().getSnapshot().transcript!;
    expect(empty.confidence).toBe('low');
    expect(empty.trusted).toBe(false);
  });

  it('reset clears state', () => {
    const p = new TranscriptProcessor();
    p.onEvent(fin('something', 1, 0));
    p.reset();
    expect(p.getSnapshot().transcript!.finalText).toBe('');
  });
});

describe('Phase 5.2 — NativeLifecycleProcessor', () => {
  it('counts finals/interims, restarts (start after first), errors; firstTextMs from first start', () => {
    const p = new NativeLifecycleProcessor();
    p.onEvent(life('start', 100));
    p.onEvent(par('a', 106, 0));                       // first text at 106 → firstTextMs 6
    p.onEvent(fin('a b', 110, 1));
    p.onEvent(life('end', 160));
    p.onEvent(life('start', 160));                     // restart
    p.onEvent(fin('a b c', 170, 2));
    p.onEvent({ type: 'engine.error', mode: 'native', t: 175, code: 'no-speech', recoverable: true });
    const e = p.getSnapshot().engine!;
    expect(e.finalCount).toBe(2);
    expect(e.interimCount).toBe(1);
    expect(e.resultCount).toBe(3);
    expect(e.restartCount).toBe(1);
    expect(e.errorCount).toBe(1);
    expect(e.firstTextMs).toBe(6);
    expect(e.lastResultMs).toBe(170);
  });

  it('starvationMs = gap between speechStart and the next result', () => {
    const p = new NativeLifecycleProcessor();
    p.onEvent(life('start', 0));
    p.onEvent(life('speechStart', 100));
    p.onEvent(fin('finally', 3500, 0));                // 3.4s of speech before a result
    expect(p.getSnapshot().engine!.starvationMs).toBe(3400);
  });
});

describe('Phase 5.2 — via MetricsEngine (both slices compose)', () => {
  it('engine merges transcript + engine slices from the two processors', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new TranscriptProcessor(), new NativeLifecycleProcessor()], 's1', 'native');
    bus.publish(life('start', 0));
    bus.publish(fin('good morning everyone', 10, 0));
    const snap = engine.getSnapshot();
    expect(snap.transcript.finalWordCount).toBe(3);
    expect(snap.engine.finalCount).toBe(1);
    expect(snap.mode).toBe('native');
    engine.dispose();
  });
});
