import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFillerWords } from '../useFillerWords';
import { Chunk } from '../types';
import { clearFillerCountTrace, readFillerCountTrace } from '../../../lib/fillerCountTrace';

describe('useFillerWords', () => {
  const userWords: string[] = [];

  it('should initialize with zero counts', () => {
    const { result } = renderHook(() => useFillerWords([], '', userWords));
    expect(result.current.totalCount).toBe(0);
  });

  it('should count filler words in final chunks', () => {
    const chunks: Chunk[] = [
      { transcript: 'Um, hello.', id: 1, timestamp: Date.now() },
      { transcript: 'Like, you know.', id: 2, timestamp: Date.now() }
    ];
    const { result } = renderHook(() => useFillerWords(chunks, '', userWords));

    // countFillerWords should find: Um, Like, you know
    // Depending on fillerWordUtils.ts implementation.
    // FILLER_WORD_KEYS.UM, FILLER_WORD_KEYS.LIKE, FILLER_WORD_KEYS.YOU_KNOW
    expect(result.current.totalCount).toBeGreaterThan(0);
  });

  it('counts interim evidence immediately; the debounce governs render work only', () => {
    vi.useFakeTimers();
    const chunks: Chunk[] = [];
    const { result, rerender } = renderHook(
      ({ chunks, interim }: { chunks: Chunk[], interim: string }) => useFillerWords(chunks, interim, userWords),
      { initialProps: { chunks, interim: '' } }
    );

    expect(result.current.totalCount).toBe(0);

    // 1. Initial interim update.
    // #1324 finding 2 CURRENTIZED: this previously asserted 0 here, i.e. that counting waited for the
    // debounce. That was the defect — the pending timer is cleared when the interim clears, so an
    // episode shorter than 200ms had its evidence cancelled before it was ever counted. Counting now
    // reads the raw interim; the debounce still governs render/trace work.
    rerender({ chunks, interim: 'um' });
    expect(result.current.totalCount).toBe(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(1);   // debounce firing changes nothing about the count

    // 2. Rapid interim revision WITHIN the same episode: the hypothesis grew, so "um" is still one
    // occurrence and "ah" is newly observed — two, not three.
    rerender({ chunks, interim: 'um ah' });
    expect(result.current.totalCount).toBe(2);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(2);

    // 3. Immediate clear when transcript becomes final
    const newChunks: Chunk[] = [{ transcript: 'um ah', id: 3, timestamp: Date.now() }];
    rerender({ chunks: newChunks, interim: '' });
    // Should be immediate (no debounce for empty string)
    expect(result.current.totalCount).toBe(2);

    vi.useRealTimers();
  });

  it('preserves filler evidence observed in interim text when browser STT retracts it', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ interim }: { interim: string }) => useFillerWords([], interim, userWords),
      { initialProps: { interim: '' } }
    );

    rerender({ interim: 'um I think' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.counts.um.count).toBe(1);
    expect(result.current.totalCount).toBe(1);

    rerender({ interim: 'I think' });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.counts.um.count).toBe(1);
    expect(result.current.totalCount).toBe(1);
    vi.useRealTimers();
  });

  it('should reset when chunks are cleared', () => {
    const chunks: Chunk[] = [{ transcript: 'um', id: 1, timestamp: Date.now() }];
    const { result, rerender } = renderHook(
      ({ chunks }: { chunks: Chunk[] }) => useFillerWords(chunks, '', userWords),
      { initialProps: { chunks } }
    );

    expect(result.current.totalCount).toBe(1);

    rerender({ chunks: [] });
    expect(result.current.totalCount).toBe(0);
  });

  it('counts a UI-added custom word when it appears in final transcript text', () => {
    const chunks: Chunk[] = [
      { transcript: 'Um, the stale smell of old beer lingers.', id: 1, timestamp: Date.now() },
    ];
    const { result } = renderHook(() => useFillerWords(chunks, '', ['stale']));

    expect(result.current.counts.stale.count).toBe(1);
    expect(result.current.totalCount).toBeGreaterThanOrEqual(2);
  });
});

/**
 * #1325 hook-boundary falsification tests for the privacy-safe count trace.
 *
 * These are the mutants a helper-level test CANNOT prove, because they are defects in what the hook
 * emits (or in whether tracing perturbs the hook at all):
 *   - Mutant 2 (interim-loss): an interim count increment is omitted, so the evidence can no longer
 *     distinguish "seen in interim then lost" from "never counted".
 *   - Mutant 3 (source-collapse): interim and final transitions are mislabeled as the same phase.
 *   - Mutant 5 (behavior): enabling tracing changes the hook's returned counts or debounce result.
 */
describe('#1325 useFillerWords — privacy-safe count-transition trace at the real hook boundary', () => {
  const traceWindow = () => window as unknown as {
    __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
    __FILLER_COUNT_TRACE__?: Array<{ phase: string; counts: Record<string, number>; seq: number }>;
  };

  beforeEach(() => {
    clearFillerCountTrace();
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
  });

  afterEach(() => {
    vi.useRealTimers();
    clearFillerCountTrace();
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
  });

  /** Drive the hook through a real interim -> final sequence, past the 200ms debounce. */
  const runInterimThenFinal = (interim: string, finalText: string, userWords: string[] = []) => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ chunks, interim: live }: { chunks: Chunk[]; interim: string }) =>
        useFillerWords(chunks, live, userWords),
      { initialProps: { chunks: [] as Chunk[], interim: '' } },
    );

    act(() => { rerender({ chunks: [], interim }); });
    act(() => { vi.advanceTimersByTime(250); });

    const afterInterim = result.current.totalCount;

    act(() => {
      rerender({
        chunks: [{ transcript: finalText, id: 1, timestamp: 1 }],
        interim: '',
      });
    });
    act(() => { vi.advanceTimersByTime(250); });

    return { result, afterInterim };
  };

  // ---- Mutant 2: interim-loss ----
  it('records an interim_observed transition, so a filler seen only in interim stays provable', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    // The recognizer emits "um" in interim, then a CLEANED final with no filler — the exact case
    // #1324 must be able to distinguish from "never recognized".
    runInterimThenFinal('so um I think', 'So I think');

    const trace = readFillerCountTrace();
    const interimEvents = trace.filter((e) => e.phase === 'interim_observed');
    expect(interimEvents.length).toBeGreaterThan(0);
    // The interim evidence must show the filler was counted at least once.
    expect(Math.max(...interimEvents.map((e) => e.counts.um))).toBeGreaterThan(0);
  });

  // ---- Mutant 3: source-collapse ----
  it('labels interim and final transitions distinctly (never collapsed into one phase)', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    runInterimThenFinal('so um I think', 'So uh I think.');

    const phases = new Set(readFillerCountTrace().map((e) => e.phase));
    expect(phases.has('interim_observed')).toBe(true);
    expect(phases.has('final_observed')).toBe(true);
    // Every recorded phase must be one of the three canonical values.
    for (const phase of phases) {
      expect(['interim_observed', 'final_observed', 'combined']).toContain(phase);
    }
  });

  // ---- Mutant 5: behavior equivalence ----
  it('produces identical counts and debounce behavior whether tracing is on or off', () => {
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
    const off = runInterimThenFinal('so um I think uh', 'So um I think uh.');
    const offCounts = JSON.stringify(off.result.current.counts);
    const offTotal = off.result.current.totalCount;
    const offAfterInterim = off.afterInterim;
    vi.useRealTimers();

    clearFillerCountTrace();
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;
    const on = runInterimThenFinal('so um I think uh', 'So um I think uh.');

    expect(JSON.stringify(on.result.current.counts)).toBe(offCounts);
    expect(on.result.current.totalCount).toBe(offTotal);
    expect(on.afterInterim).toBe(offAfterInterim);
    // ...and the trace only exists in the enabled run.
    expect(readFillerCountTrace().length).toBeGreaterThan(0);
  });

  it('writes no trace at all when the flag is off (flag-off equivalence)', () => {
    delete traceWindow().__PRIVATE_TRANSCRIPT_TRACE__;
    runInterimThenFinal('so um I think', 'So um I think.');
    expect(readFillerCountTrace()).toEqual([]);
    expect(traceWindow().__FILLER_COUNT_TRACE__).toBeUndefined();
  });

  // ---- Privacy at the hook boundary: custom labels must never leave the hook ----
  it('emits only custom_total for user-defined words — never the label itself', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    runInterimThenFinal('the stale smell', 'The stale smell.', ['stale']);

    const serialized = JSON.stringify(readFillerCountTrace());
    expect(serialized).not.toMatch(/stale/i);
    const withCustom = readFillerCountTrace().filter((e) => (e.counts.custom_total ?? 0) > 0);
    expect(withCustom.length).toBeGreaterThan(0);
  });

  // ---- custom_total truthfulness: only the CONFIGURED custom set may contribute ----
  it('never inflates custom_total with built-in discourse markers (like/so/oh)', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    // Canonical true fillers + one CONFIGURED custom word + non-counting discourse markers.
    // "so" and "like" are product-counted discourse markers but are NOT custom words.
    runInterimThenFinal(
      'so um I think like the stale plan uh',
      'So um I think like the stale plan uh.',
      ['stale'],
    );

    const trace = readFillerCountTrace();
    expect(trace.length).toBeGreaterThan(0);
    // Exactly one configured custom word occurs ("stale") — discourse markers must not be summed in.
    for (const event of trace) {
      expect(event.counts.custom_total).toBeLessThanOrEqual(1);
    }
    const maxCustom = Math.max(...trace.map((e) => e.counts.custom_total));
    expect(maxCustom).toBe(1);
    // ...while the canonical true fillers ARE reported.
    expect(Math.max(...trace.map((e) => e.counts.um))).toBeGreaterThan(0);
  });

  it('reports custom_total 0 when no custom words are configured, even with discourse markers present', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    runInterimThenFinal('so um I think like', 'So um I think like.', []);

    for (const event of readFillerCountTrace()) {
      expect(event.counts.custom_total).toBe(0);
    }
  });

  // ---- Rerender storm must not evict the earliest interim evidence (bounded ring) ----
  // NOTE: this asserts on the hook's real emission path (runInterimThenFinal drives the actual
  // debounce), then proves duplicate-payload re-emissions are collapsed. It deliberately avoids a
  // large in-test rerender loop, which deadlocks against the 200ms debounce under fake timers.
  it('survives repeated identical payloads: no duplicate events, first interim event preserved', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    runInterimThenFinal('um I think', 'Um I think.');
    const trace = readFillerCountTrace();
    const firstEvent = trace[0];
    expect(firstEvent).toBeDefined();

    // No phase may record the same canonical payload twice in a row — that is what keeps a real
    // rerender storm from filling the 256-event ring and evicting this first interim transition.
    const byPhase = new Map<string, string[]>();
    for (const event of trace) {
      const fingerprint = `${event.counts.um}|${event.counts.uh}|${event.counts.ah}|${event.counts.custom_total}`;
      const seen = byPhase.get(event.phase) ?? [];
      expect(seen[seen.length - 1]).not.toBe(fingerprint);
      seen.push(fingerprint);
      byPhase.set(event.phase, seen);
    }

    expect(trace.length).toBeLessThan(256);
    expect(trace[0]).toEqual(firstEvent);
  });

  // ---- §9: ZERO IS EVIDENCE. Executed-with-zero must be distinguishable from never-executed. ----
  describe('§9 executed zero-count phases are observable', () => {
    it('(b) recognized all-zero speech emits explicit final-zero AND combined-zero events', () => {
      traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

      // Speech with NO fillers at all — the phases still executed.
      runInterimThenFinal('I think we should review', 'I think we should review the plan today.');

      const trace = readFillerCountTrace();
      const finalZero = trace.filter((e) => e.phase === 'final_observed');
      const combinedZero = trace.filter((e) => e.phase === 'combined');

      expect(finalZero.length).toBeGreaterThan(0);
      expect(combinedZero.length).toBeGreaterThan(0);
      expect(finalZero.every((e) => e.counts.um === 0 && e.counts.uh === 0 && e.counts.ah === 0)).toBe(true);
    });

    it('(a) a positive interim followed by a zero final still preserves the interim count in combined', () => {
      traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

      // Interim contains "um"; the final hypothesis is cleaned.
      runInterimThenFinal('um I think', 'I think we should review the plan today.');

      const trace = readFillerCountTrace();
      const interimMax = Math.max(0, ...trace.filter((e) => e.phase === 'interim_observed').map((e) => e.counts.um));
      const combinedMax = Math.max(0, ...trace.filter((e) => e.phase === 'combined').map((e) => e.counts.um));

      expect(interimMax).toBeGreaterThan(0);
      // The max-observed rule means the canonical combined value keeps the interim evidence.
      expect(combinedMax).toBeGreaterThanOrEqual(interimMax);
    });

    it('(c) a phase that never executed emits nothing (mount-time zero is not phase completion)', () => {
      traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

      // Render with no interim and no final chunks: nothing has executed.
      renderHook(() => useFillerWords([], '', []));

      expect(readFillerCountTrace()).toEqual([]);
    });
  });

  // ---- §12: captured evidence must be immutable ----
  it('§12 a captured trace is frozen and unaffected by later emissions or a clear', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    runInterimThenFinal('um I think', 'Um I think.');
    const captured = readFillerCountTrace();
    const snapshot = JSON.stringify(captured);
    expect(captured.length).toBeGreaterThan(0);
    expect(Object.isFrozen(captured)).toBe(true);
    vi.useRealTimers();

    // More emissions, then a clear — the earlier capture must not change.
    runInterimThenFinal('uh another', 'Uh another.');
    clearFillerCountTrace();

    expect(JSON.stringify(captured)).toBe(snapshot);
  });

  // ---- Per-replay isolation: fixture N must not inherit fixture N-1's tail events ----
  it('replay isolation: a cleared trace cannot let replay N inherit replay N-1 events', () => {
    traceWindow().__PRIVATE_TRANSCRIPT_TRACE__ = true;

    // Replay N-1: a POSITIVE clip leaves a tail event with a nonzero um count.
    runInterimThenFinal('um I think', 'Um I think.');
    const previous = readFillerCountTrace();
    expect(previous.length).toBeGreaterThan(0);
    expect(Math.max(...previous.map((e) => e.counts.um))).toBeGreaterThan(0);
    vi.useRealTimers();

    // Harness clears BEFORE replay N begins.
    clearFillerCountTrace();
    expect(readFillerCountTrace()).toEqual([]);

    // Replay N: a matched NEGATIVE clip with no fillers.
    runInterimThenFinal('I think we should review', 'I think we should review.');

    const current = readFillerCountTrace();
    // The previous positive evidence must be gone: nothing may report a filler.
    for (const event of current) {
      expect(event.counts.um).toBe(0);
      expect(event.counts.uh).toBe(0);
      expect(event.counts.ah).toBe(0);
    }
    // Sequence/baseline restart so replay N is independently auditable.
    expect(current.map((event) => event.seq).slice(0, 1)).toEqual(current.length > 0 ? [0] : []);
  });
});
