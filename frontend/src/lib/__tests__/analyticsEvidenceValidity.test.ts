/**
 * #1045 — evidence validity for displayed metrics.
 *
 * These lock the two defects a Product Owner hit on a real account: "Clear Delivery 0%" while
 * individual saved sessions carried genuine non-zero scores, and "Avg. Session Length 0 mins" for
 * sessions that definitely happened. Both came from the same mistake — treating absent or
 * unscorable evidence as the number zero — and both are statements about the user's speaking that
 * were simply untrue.
 *
 * Out of scope by design: any threshold for what makes a session eligible for Progress. That is the
 * Progress formula's decision, not this PR's.
 */
import { describe, it, expect } from 'vitest';
import { calculateOverallStats } from '../analyticsUtils';
import { formatDurationMinutes, hasValidPauseEvidence, isValidMetric, NOT_ENOUGH_DATA } from '@/utils/metricValidity';
import { decodeClarity, decodePauseRhythm, decodeFillers, decodePace, getTryThisNext } from '@/utils/coachingNarrative';
import type { PracticeSession } from '@/types/session';

const session = (over: Partial<PracticeSession> = {}): PracticeSession => ({
    id: 'sess',
    user_id: 'u',
    created_at: '2026-07-20T10:00:00Z',
    duration: 300,
    total_words: 600,
    transcript: Array.from({ length: 600 }, (_, i) => `word${i}`).join(' '),
    filler_words: {},
    ...over,
} as PracticeSession);

describe('#1045 aggregate evidence validity', () => {
    it('does NOT drag Clear Delivery to 0% with sessions that were never scorable', () => {
        // One real 600-word take with a genuine score, plus three accidental near-empty takes.
        // The old average divided the single real score by 4 and reported a near-zero clarity.
        const history = [
            session({ id: 'real', clarity_score: 88 }),
            session({ id: 'blip-1', duration: 4, total_words: 0, transcript: '' }),
            session({ id: 'blip-2', duration: 3, total_words: 0, transcript: '' }),
            session({ id: 'blip-3', duration: 2, total_words: 0, transcript: '' }),
        ];

        const stats = calculateOverallStats(history);

        expect(stats.avgClarity).not.toBeNull();
        expect(Number(stats.avgClarity)).toBeGreaterThan(50);
    });

    it('reports Clear Delivery as unknown — not 0% — when NO session is scorable', () => {
        const stats = calculateOverallStats([
            session({ duration: 4, total_words: 0, transcript: '' }),
            session({ duration: 3, total_words: 0, transcript: '' }),
        ]);

        expect(stats.avgClarity).toBeNull();
    });

    it('reports pace as unknown rather than 0 WPM when nothing was transcribed', () => {
        const stats = calculateOverallStats([session({ duration: 30, total_words: 0, transcript: '' })]);
        expect(stats.averageWPM).toBeNull();
    });

    it('reports pause rhythm as unknown when no session recorded pause metrics', () => {
        // Every session contributes 0 pauses purely because the data is absent. "Sparse" would be a
        // judgment invented from nothing.
        const stats = calculateOverallStats([session(), session()]);
        expect(stats.avgPausesPerMin).toBeNull();
    });

    it('does not praise SILENCE as clean delivery — a filler rate needs words, not just time', () => {
        // A 6-second wordless take has duration > 0. Reporting "0.0 fillers/min" decodes to the
        // POSITIVE label "Low", so silence could become the user's "What worked".
        const stats = calculateOverallStats([session({ duration: 6, total_words: 0, transcript: '' })]);
        expect(stats.avgFillerWordsPerMin).toBeNull();
    });

    it('keeps a GENUINE zero when the evidence is real', () => {
        // Real speech, real duration, zero fillers — that is a true and valuable 0.0/min.
        const stats = calculateOverallStats([session({ filler_words: {} })]);
        expect(stats.avgFillerWordsPerMin).not.toBeNull();
        expect(Number(stats.avgFillerWordsPerMin)).toBe(0);
    });

    it('exposes exact seconds so a short average is not rounded into a false zero', () => {
        const stats = calculateOverallStats([session({ duration: 25 }), session({ duration: 20 })]);
        expect(stats.averageSessionLengthSeconds).toBeCloseTo(22.5, 5);
    });

    it('returns unknown for every aggregate when there is no history at all', () => {
        const stats = calculateOverallStats([]);
        expect(stats.avgClarity).toBeNull();
        expect(stats.averageWPM).toBeNull();
        expect(stats.avgFillerWordsPerMin).toBeNull();
        expect(stats.avgPausesPerMin).toBeNull();
        expect(stats.averageSessionLengthSeconds).toBeNull();
    });
});

describe('#1045 honest duration formatting', () => {
    it('never reports a real recording as "0 mins"', () => {
        expect(formatDurationMinutes(25)).toBe('<1 min');
        expect(formatDurationMinutes(59)).toBe('<1 min');
    });

    it('formats ordinary durations normally', () => {
        expect(formatDurationMinutes(60)).toBe('1 min');
        expect(formatDurationMinutes(303)).toBe('5 mins');
    });

    it('distinguishes a true zero from missing evidence', () => {
        expect(formatDurationMinutes(0)).toBe('0 mins');
        expect(formatDurationMinutes(null)).toBe(NOT_ENOUGH_DATA);
        expect(formatDurationMinutes(undefined)).toBe(NOT_ENOUGH_DATA);
        expect(formatDurationMinutes(NaN)).toBe(NOT_ENOUGH_DATA);
    });
});

describe('#1045 no judgment without evidence', () => {
    it.each([
        ['clarity', decodeClarity],
        ['pause rhythm', decodePauseRhythm],
        ['fillers', decodeFillers],
        ['pace', decodePace],
    ])('%s refuses to label a missing value', (_name, decode) => {
        for (const missing of [null, undefined, NaN, Infinity]) {
            const result = decode(missing as unknown as number);
            expect(result.isEvidenceMissing).toBe(true);
            expect(result.label).toBe(NOT_ENOUGH_DATA);
        }
    });

    it('still judges real values, including a genuine zero', () => {
        expect(decodeFillers(0).isEvidenceMissing).toBeFalsy();
        expect(decodeFillers(0).label).toBe('Low');
    });
});

describe('#1045 metric validity predicate', () => {
    it('rejects only the values we cannot stand behind', () => {
        expect(isValidMetric(0)).toBe(true);
        expect(isValidMetric('0.0')).toBe(true);
        expect(isValidMetric(42)).toBe(true);
        expect(isValidMetric(null)).toBe(false);
        expect(isValidMetric(undefined)).toBe(false);
        expect(isValidMetric(NaN)).toBe(false);
        expect(isValidMetric(Infinity)).toBe(false);
    });

    it('rejects a blank string — Number("") is 0, which would be a fabricated zero', () => {
        // The one gate that exists to stop fabricated zeros must not be the thing that creates one.
        // Reachable wherever unvalidated server JSON is cast rather than parsed.
        expect(isValidMetric('')).toBe(false);
        expect(isValidMetric('   ')).toBe(false);
        expect(isValidMetric('not a number')).toBe(false);
        // A real zero, in either representation, is still valid evidence.
        expect(isValidMetric('0')).toBe(true);
        expect(isValidMetric(0)).toBe(true);
    });
});

/**
 * #1045 correction batch, finding 1 — pause evidence is validated STRUCTURALLY.
 * An empty `{}` snapshot is a truthy object carrying no measurement; treating its presence as
 * evidence reintroduces the exact false zero this PR removes.
 */
describe('#1045 pause evidence is structural, not truthiness', () => {
    const complete = { silencePercentage: 12.5, transitionPauses: 4, extendedPauses: 1, longestPause: 2.3 };

    it('rejects missing and empty snapshots', () => {
        expect(hasValidPauseEvidence(undefined)).toBe(false);
        expect(hasValidPauseEvidence(null)).toBe(false);
        expect(hasValidPauseEvidence({})).toBe(false);
    });

    it('rejects malformed snapshots', () => {
        expect(hasValidPauseEvidence({ ...complete, longestPause: undefined })).toBe(false);
        expect(hasValidPauseEvidence({ ...complete, transitionPauses: 'lots' })).toBe(false);
        expect(hasValidPauseEvidence({ ...complete, silencePercentage: NaN })).toBe(false);
        expect(hasValidPauseEvidence([complete])).toBe(false);
        expect(hasValidPauseEvidence('pauses')).toBe(false);
    });

    it('ACCEPTS a structurally valid measured zero — that is a real finding, not missing data', () => {
        expect(hasValidPauseEvidence({
            silencePercentage: 0, transitionPauses: 0, extendedPauses: 0, longestPause: 0,
        })).toBe(true);
    });

    it('accepts a structurally valid non-zero snapshot', () => {
        expect(hasValidPauseEvidence(complete)).toBe(true);
    });

    it('does not let an empty snapshot become a pause rate in the aggregate', () => {
        const stats = calculateOverallStats([
            session({ pause_metrics: {} as never }),
            session({ pause_metrics: {} as never }),
        ]);
        expect(stats.avgPausesPerMin).toBeNull();
    });

    it('does count a structurally valid measured zero as evidence', () => {
        const stats = calculateOverallStats([
            session({ pause_metrics: { silencePercentage: 0, transitionPauses: 0, extendedPauses: 0, longestPause: 0 } }),
        ]);
        expect(stats.avgPausesPerMin).not.toBeNull();
        expect(Number(stats.avgPausesPerMin)).toBe(0);
    });
});

/**
 * #1045 correction batch, finding 2 — RELEASE BLOCKER for the product orientation.
 * The user gets exactly two prescriptions. Neither may ever be manufactured from a metric we did
 * not measure.
 */
describe('#1045 missing evidence never becomes coaching', () => {
    it('does not prescribe a pace/filler/pause/clarity action for a wordless session', () => {
        const allUnknown = calculateOverallStats([
            session({ duration: 6, total_words: 0, transcript: '' }),
        ]);

        const result = getTryThisNext({
            avgWpm: allUnknown.averageWPM,
            avgPausesPerMin: allUnknown.avgPausesPerMin,
            avgFillerWordsPerMin: allUnknown.avgFillerWordsPerMin,
            avgClarity: allUnknown.avgClarity,
        });

        expect(result.driver).toBeNull();
        // The old ranking treated NO_EVIDENCE (tone 'watch') as a real weakness and returned a
        // confident instruction about speech that was never measured.
        expect(result.action).not.toMatch(/pick up the pace|ease the pace|beat of silence/i);
        expect(result.action).toMatch(/record a longer take/i);
    });

    it('never names a driver whose evidence is unavailable', () => {
        // Only pace is measurable; every other signal is unknown.
        const result = getTryThisNext({
            avgWpm: 205,               // genuinely too fast -> the only supportable prescription
            avgPausesPerMin: null,
            avgFillerWordsPerMin: null,
            avgClarity: null,
        });
        expect(result.driver).toBe('pace');
    });

    it('still coaches normally when the evidence is there', () => {
        const result = getTryThisNext({
            avgWpm: 140, avgPausesPerMin: 20, avgFillerWordsPerMin: 1, avgClarity: 90,
        });
        expect(result.driver).toBe('pause rhythm'); // 20/min is Choppy
    });
});
