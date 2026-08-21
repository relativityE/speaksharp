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

  it('should handle interim transcript transiently with debounce', () => {
    vi.useFakeTimers();
    const chunks: Chunk[] = [];
    const { result, rerender } = renderHook(
      ({ chunks, interim }: { chunks: Chunk[], interim: string }) => useFillerWords(chunks, interim, userWords),
      { initialProps: { chunks, interim: '' } }
    );

    expect(result.current.totalCount).toBe(0);

    // 1. Initial interim update
    rerender({ chunks, interim: 'um' });
    // Should still be 0 due to debounce
    expect(result.current.totalCount).toBe(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(1);

    // 2. Rapid interim update
    rerender({ chunks, interim: 'um ah' });
    expect(result.current.totalCount).toBe(1); // Still previous value

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
});
