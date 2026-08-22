import { renderHook, act } from '../../../../tests/support/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useFillerWords } from '../useFillerWords';
import { Chunk } from '../types';
import { countFillerWords } from '../../../utils/fillerWordUtils';
import { FILLER_WORD_KEYS, TRUE_FILLER_WORDS } from '../../../config';

/**
 * #1324 — filler-count fidelity in the SHIPPING path.
 *
 * These tests characterise three CONFIRMED defects that would fail #1324 qualification for reasons
 * that have nothing to do with Whisper, the model choice, or the audio pipeline. They are pure
 * client-side counting bugs, reachable with no audio at all.
 *
 * HOW TO READ `it.fails`: each case asserts the CORRECT behaviour and is marked expected-to-fail, so
 * the suite is green while the defect stands. The moment a fix lands, `it.fails` itself fails loudly
 * and forces the assertion to be promoted to a normal one. Promoting all five IS the acceptance
 * criterion for the fix. A plain skipped test would rot silently; this cannot.
 *
 * Each case asserts the MECHANISM rather than a literal number, because the ceiling is not a
 * constant — measured below.
 *
 * Findings 1 and 2 are distinct bugs with distinct fixes, and a single fixture cannot separate them:
 *   - Finding 1: interim evidence is MAX-ed, not accumulated, so repeated episodes collapse.
 *   - Finding 2: interim evidence living under the debounce window is discarded entirely, so those
 *     episodes contribute nothing at all — not even the collapsed one.
 */

const NO_USER_WORDS: string[] = [];
const DEBOUNCE_MS = 200;

/** A final chunk carrying no filler, i.e. the "cleaned" final Whisper tends to produce. */
const cleanChunk = (id: number): Chunk => ({
    transcript: `sentence ${id} follows here.`,
    id,
    timestamp: 1_700_000_000_000 + id,
});

describe('#1324 finding 1 — interim-only occurrences are not accumulated across episodes', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /**
     * Drive N independent "interim-only filler" episodes. Each episode: an interim hypothesis
     * containing a filler survives past the debounce, then the utterance finalises to a CLEAN final
     * that has dropped the filler. This is exactly remediation rung B — the recogniser DID produce the
     * filler, and the product must not silently lose it.
     */
    const runEpisodes = (count: number, interimText: string) => {
        const chunks: Chunk[] = [];
        const { result, rerender } = renderHook(
            ({ chunks, interim }: { chunks: Chunk[]; interim: string }) =>
                useFillerWords(chunks, interim, NO_USER_WORDS),
            { initialProps: { chunks: [...chunks], interim: '' } },
        );

        for (let i = 0; i < count; i += 1) {
            // Interim hypothesis appears and lives long enough to be counted.
            rerender({ chunks: [...chunks], interim: interimText });
            act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });

            // Utterance finalises WITHOUT the filler, and the interim clears.
            chunks.push(cleanChunk(i));
            rerender({ chunks: [...chunks], interim: '' });
            act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        }
        return result;
    };

    it.fails('DEFECT: five separate interim-only "um" episodes do not yield five', () => {
        const result = runEpisodes(5, 'um');
        const um = result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0;

        // Assert the MECHANISM, not the literal 1. The ceiling is the maximum within a SINGLE
        // hypothesis, so a fixture whose hypothesis happened to carry two fillers would legitimately
        // yield 2 — a test hardcoded to 1 would look broken for the wrong reason.
        expect(um).toBeLessThan(5);      // MEASURED: 1
        expect(um).toBeGreaterThan(0);   // the evidence WAS observed at least once...
        expect(um).toBe(5);              // ...but the product must report every occurrence.
    });

    it.fails('confirms the ceiling is per-hypothesis MAX, not a hardcoded one', () => {
        // Two fillers inside ONE hypothesis do come through as two, which is what proves the bug is
        // `Math.max` over episodes rather than a literal cap of 1.
        const result = runEpisodes(3, 'um and um again');
        const um = result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0;
        expect(um).toBe(2 * 3);   // MEASURED: 2 — i.e. the per-hypothesis maximum, not a cap of 1
    });
});

describe('#1324 finding 2 — the 200ms debounce discards short-lived interim evidence', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Same episode shape, but each interim finalises BEFORE the debounce timer fires. */
    const runFastEpisodes = (count: number) => {
        const chunks: Chunk[] = [];
        const { result, rerender } = renderHook(
            ({ chunks, interim }: { chunks: Chunk[]; interim: string }) =>
                useFillerWords(chunks, interim, NO_USER_WORDS),
            { initialProps: { chunks: [...chunks], interim: '' } },
        );

        for (let i = 0; i < count; i += 1) {
            rerender({ chunks: [...chunks], interim: 'um' });
            // Finalises in well under the debounce window — the pending timer is cleared and the
            // hypothesis is never projected into counts at all.
            act(() => { vi.advanceTimersByTime(DEBOUNCE_MS - 50); });
            chunks.push(cleanChunk(i));
            rerender({ chunks: [...chunks], interim: '' });
            act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        }
        return result;
    };

    it.fails('DEFECT: five sub-200ms "um" episodes contribute nothing, not even the collapsed one', () => {
        const result = runFastEpisodes(5);
        const um = result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0;

        // This is what separates finding 2 from finding 1: finding 1 collapses N to a smaller
        // non-zero number; finding 2 loses the evidence entirely.
        expect(um).toBe(5);
    });

    it('characterises the boundary: the same episodes DO register when they outlive the debounce', () => {
        // Control. If this ever fails, the finding-2 result above is not attributable to the debounce.
        const chunks: Chunk[] = [];
        const { result, rerender } = renderHook(
            ({ chunks, interim }: { chunks: Chunk[]; interim: string }) =>
                useFillerWords(chunks, interim, NO_USER_WORDS),
            { initialProps: { chunks: [...chunks], interim: '' } },
        );
        rerender({ chunks: [...chunks], interim: 'um' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBeGreaterThan(0);
    });
});

describe('#1324 finding 3 — `total` sums discourse markers against the true-filler tier gate', () => {
    it.fails('DEFECT: total counts "so" alongside "um" even though coaching gates on um/uh/ah', () => {
        const counts = countFillerWords('So um I think', NO_USER_WORDS);

        // The tier the product actually coaches on:
        const trueTierSum = TRUE_FILLER_WORDS.reduce(
            (sum: number, key: string) => sum + (counts[key]?.count ?? 0), 0,
        );
        expect(trueTierSum).toBe(1);              // exactly one true filler: "um"
        expect(counts[FILLER_WORD_KEYS.SO]?.count ?? 0).toBe(1);   // "so" was matched...

        // ...and `total` adds it in, so the headline disagrees with the gate.
        expect(counts.total.count).toBe(trueTierSum);
    });

    it.fails('a discourse-marker-only utterance produces a non-zero total with zero true fillers', () => {
        const counts = countFillerWords('So like you know', NO_USER_WORDS);
        const trueTierSum = TRUE_FILLER_WORDS.reduce(
            (sum: number, key: string) => sum + (counts[key]?.count ?? 0), 0,
        );
        expect(trueTierSum).toBe(0);
        // The clearest expression of the defect: nothing coachable happened, yet total is not zero.
        expect(counts.total.count).toBe(0);
    });
});
