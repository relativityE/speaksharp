import { describe, it, expect } from 'vitest';
import { PaceProcessor } from '../PaceProcessor';
import { FillerProcessor } from '../FillerProcessor';
import { InMemoryTelemetryBus } from '../../TelemetryBus';
import { MetricsEngine } from '../../MetricsEngine';
import { calculateWpm } from '@/utils/sessionAnalysis';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { countedFillerTotal } from '@/utils/fillerTiers';
import type { TelemetryEvent } from '../../contracts';

const fin = (text: string, t: number, seq: number): TelemetryEvent =>
  ({ type: 'transcript.final', mode: 'private', t, text, sequence: seq, replacesRollingTranscript: true });

describe('Phase 5.3 — PaceProcessor (shadow, parity with calculateWpm)', () => {
  it('wpm = calculateWpm(wordCount, elapsedSeconds) from event timestamps', () => {
    const p = new PaceProcessor();
    p.onEvent(fin('one two three four five six', 0, 0));       // 6 words
    p.onEvent(fin('one two three four five six seven eight nine ten', 60_000, 1)); // 10 words @ 60s
    const wpm = p.getSnapshot().delivery!.wpm;
    expect(wpm).toBe(calculateWpm(10, 60)); // byte-identical to the existing calculator
    expect(wpm).toBe(10);
  });
  it('reset clears', () => {
    const p = new PaceProcessor();
    p.onEvent(fin('a b c', 0, 0));
    p.reset();
    expect(p.getSnapshot().delivery!.wpm).toBe(0);
  });
});

describe('Phase 5.3 — FillerProcessor (shadow, parity with countFillerWords)', () => {
  it('fillerCount = TRUE-filler tier (countedFillerTotal); fillerRate = count/words × 100 (#1231)', () => {
    const text = 'um so like this is you know basically the point';
    const p = new FillerProcessor();
    p.onEvent(fin(text, 0, 0));
    const d = p.getSnapshot().delivery!;
    // #1231: the shadow snapshot re-tiers to true fillers (um) — 'so'/'like'/'you know'/'basically' are
    // discourse markers, excluded by default — matching the legacy metrics path so #1052 parity holds.
    const expected = countedFillerTotal(countFillerWords(text))!;
    expect(d.fillerCount).toBe(expected);
    expect(d.fillerCount).toBe(1); // um only
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(d.fillerRate).toBeCloseTo((expected / words) * 100, 6);
  });
  it('empty transcript = 0 fillers, 0 rate', () => {
    expect(new FillerProcessor().getSnapshot().delivery!).toEqual({ fillerCount: 0, fillerRate: 0 });
  });
});

describe('Phase 5.3 — Pace + Filler compose in delivery WITHOUT clobbering (patch merge)', () => {
  it('engine merges wpm (Pace) and fillerCount/fillerRate (Filler) into one delivery section', () => {
    const bus = new InMemoryTelemetryBus('s1');
    const engine = new MetricsEngine(bus, [new PaceProcessor(), new FillerProcessor()], 's1', 'private');
    bus.publish(fin('um so basically the point here', 0, 0));
    bus.publish(fin('um so basically the point here is that it works fine now', 30_000, 1));
    const d = engine.getSnapshot().delivery;
    // Pace's field is present AND Filler's fields are present — neither zeroed the other.
    expect(d.wpm).toBeGreaterThan(0);
    expect(d.fillerCount).toBeGreaterThan(0);
    expect(d.fillerRate).toBeGreaterThan(0);
    // untouched delivery field kept its default
    expect(d.clarityScore).toBe(0);
    engine.dispose();
  });
});
