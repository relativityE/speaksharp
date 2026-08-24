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
 * PROMOTED TO ACCEPTANCE (#1331 subtask D). These began as `it.fails` characterizations proving the
 * defects existed; the fixes have landed, so each now asserts the correct behaviour directly
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

    it('five separate interim-only "um" episodes yield five', () => {
        // Each episode is a distinct spoken occurrence, even though the final chunk dropped the filler.
        const result = runEpisodes(5, 'um');
        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(5);
    });

    it('two occurrences inside one hypothesis, across three episodes, yield six', () => {
        // Guards BOTH directions at once: the per-episode maximum must survive (2 per episode), and
        // episodes must accumulate (x3). A regression to session-wide max gives 2; a regression to
        // summing every revision gives far more than 6.
        const result = runEpisodes(3, 'um and um again');
        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(6);
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

    it('five sub-200ms "um" episodes are all counted', () => {
        // Counting must not depend on the debounce timer firing: these episodes finalise before it
        // would, and previously their evidence was cancelled with the pending timer.
        const result = runFastEpisodes(5);
        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(5);
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

describe('#1324 reconciliation — rolling revisions and interim/final overlap', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const mount = () => {
        const chunks: Chunk[] = [];
        const { result, rerender } = renderHook(
            ({ chunks, interim }: { chunks: Chunk[]; interim: string }) =>
                useFillerWords(chunks, interim, NO_USER_WORDS),
            { initialProps: { chunks: [...chunks], interim: '' } },
        );
        return { chunks, result, rerender };
    };

    it('rolling revisions of ONE hypothesis count the occurrence once', () => {
        // The recogniser rewrites its hypothesis in place; the same spoken "um" reappears in each
        // revision. Summing revisions would invent occurrences that were never spoken.
        const { chunks, result, rerender } = mount();
        for (const interim of ['um I', 'um I think', 'um I think that']) {
            rerender({ chunks: [...chunks], interim });
            act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        }
        chunks.push(cleanChunk(1));
        rerender({ chunks: [...chunks], interim: '' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });

        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(1);
    });

    it('an occurrence seen in BOTH interim and final counts once, not twice', () => {
        // Same spoken word, observed twice by the pipeline. The episode contributes the maximum of its
        // interim and final evidence, never their sum.
        const { chunks, result, rerender } = mount();
        rerender({ chunks: [...chunks], interim: 'um hello' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        chunks.push({ transcript: 'um hello there.', id: 1, timestamp: 1_700_000_001 });
        rerender({ chunks: [...chunks], interim: '' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });

        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(1);
    });

    it('a final-only occurrence is still counted', () => {
        // Interim recovery must not replace or suppress finalized evidence.
        const { chunks, result, rerender } = mount();
        chunks.push({ transcript: 'well um that happened.', id: 1, timestamp: 1_700_000_001 });
        rerender({ chunks: [...chunks], interim: '' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });

        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(1);
    });

    it('a final carrying MORE occurrences than the interim reports the final count', () => {
        // The maximum must be per-key and directional-agnostic: interim 1, final 2 -> 2.
        const { chunks, result, rerender } = mount();
        rerender({ chunks: [...chunks], interim: 'um' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });
        chunks.push({ transcript: 'um and um again.', id: 1, timestamp: 1_700_000_001 });
        rerender({ chunks: [...chunks], interim: '' });
        act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 50); });

        expect(result.current.counts[FILLER_WORD_KEYS.UM]?.count ?? 0).toBe(2);
    });
});

describe('#1324 finding 3 — `total` sums discourse markers against the true-filler tier gate', () => {
    it('total counts only the coachable tier, so "So um I think" is one', () => {
        const counts = countFillerWords('So um I think', NO_USER_WORDS);

        // The tier the product actually coaches on:
        const trueTierSum = TRUE_FILLER_WORDS.reduce(
            (sum: number, key: string) => sum + (counts[key]?.count ?? 0), 0,
        );
        expect(trueTierSum).toBe(1);              // exactly one true filler: "um"
        expect(counts[FILLER_WORD_KEYS.SO]?.count ?? 0).toBe(1);   // "so" was matched...

        // ...but the headline agrees with the gate: the marker is tracked per key, not counted.
        expect(counts.total.count).toBe(trueTierSum);
    });

    it('a discourse-marker-only utterance has a zero coachable total', () => {
        const counts = countFillerWords('So like you know', NO_USER_WORDS);
        const trueTierSum = TRUE_FILLER_WORDS.reduce(
            (sum: number, key: string) => sum + (counts[key]?.count ?? 0), 0,
        );
        expect(trueTierSum).toBe(0);
        // Nothing coachable happened, so the headline is zero while the marker keys stay populated.
        expect(counts.total.count).toBe(0);
        expect(counts[FILLER_WORD_KEYS.SO]?.count ?? 0).toBeGreaterThan(0);
    });
});
