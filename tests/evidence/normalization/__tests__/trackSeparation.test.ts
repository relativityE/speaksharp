/**
 * #1304 — the two tracks are separated at COMPILE time, at RUNTIME, and in BEHAVIOUR.
 *
 * Each layer covers a hole the others cannot:
 *   * compile time stops a Track-A result reaching a Track-B consumer in source;
 *   * runtime stops it after serialization, where the type no longer exists;
 *   * behaviour proves the tracks actually differ for the intended reason — fillers — rather than
 *     merely carrying different labels.
 */
import { describe, it, expect } from 'vitest';
import { wordErrorRate, type WerResult } from '../../werMetric';
import { TRACK_NORMALIZATION } from '../tracks';
import { assertSingleTrack } from '../aggregate';

/** A consumer that accepts DISFLUENCY evidence only. */
function summarizeDisfluency(row: WerResult<'track_b'>): number | null { return row.wer; }

describe('compile-time separation', () => {
    it('a Track-A result is REJECTED by a Track-B consumer', () => {
        const trackA = wordErrorRate('a b', 'a b', { track: 'track_a' });
        // @ts-expect-error — Track A transcript-accuracy evidence is not disfluency evidence. If the
        // brand is ever removed from WerResult, this line stops erroring and `typecheck:evidence` FAILS,
        // which is exactly how this assertion is falsified.
        summarizeDisfluency(trackA);
        expect(trackA.track).toBe('track_a');
    });

    it('a Track-B result is accepted', () => {
        expect(summarizeDisfluency(wordErrorRate('a b', 'a b', { track: 'track_b' }))).toBe(0);
    });
});

describe('runtime separation survives serialization', () => {
    it('rejects aggregating rows from DIFFERENT tracks', () => {
        // A brand cannot survive JSON. Once rows are written, imported and aggregated, only this check
        // stands between Track A and Track B numbers being averaged into one meaningless figure.
        const rows = [
            wordErrorRate('a b', 'a b', { track: 'track_a' }),
            wordErrorRate('a b', 'a b', { track: 'track_b' }),
        ].map((r) => JSON.parse(JSON.stringify(r)) as WerResult);
        expect(() => assertSingleTrack(rows)).toThrow(/mixed track/i);
    });

    it('accepts rows from a single track', () => {
        const rows = [
            wordErrorRate('a b', 'a b', { track: 'track_a' }),
            wordErrorRate('c d', 'c d', { track: 'track_a' }),
        ].map((r) => JSON.parse(JSON.stringify(r)) as WerResult);
        expect(assertSingleTrack(rows)).toBe('track_a');
    });

    it('rejects a row carrying no track at all', () => {
        const untracked = [{ wer: 0 } as unknown as WerResult];
        expect(() => assertSingleTrack(untracked)).toThrow(/missing track/i);
    });
});

describe('behavioural separation — the tracks differ for the RIGHT reason', () => {
    const spoken = 'so um i think uh we should review the plan';

    it('identical filler-bearing transcripts score 0 on BOTH tracks', () => {
        expect(wordErrorRate(spoken, spoken, { track: 'track_a' }).wer).toBe(0);
        expect(wordErrorRate(spoken, spoken, { track: 'track_b' }).wer).toBe(0);
    });

    it('a hypothesis that DROPS the fillers is free on Track A and penalised on Track B', () => {
        // The whole reason for two tracks: transcript accuracy must not charge a model for the
        // official normalization removing fillers, and disfluency accuracy must not let it off.
        const dropped = 'so i think we should review the plan';
        expect(wordErrorRate(spoken, dropped, { track: 'track_a' }).wer).toBe(0);
        expect(wordErrorRate(spoken, dropped, { track: 'track_b' }).wer).toBeGreaterThan(0);
    });

    it('each track records its OWN normalization identity', () => {
        expect(wordErrorRate(spoken, spoken, { track: 'track_a' }).normalizationVersion)
            .toBe(TRACK_NORMALIZATION.track_a);
        expect(wordErrorRate(spoken, spoken, { track: 'track_b' }).normalizationVersion)
            .toBe(TRACK_NORMALIZATION.track_b);
        expect(TRACK_NORMALIZATION.track_a).not.toBe(TRACK_NORMALIZATION.track_b);
    });
});
