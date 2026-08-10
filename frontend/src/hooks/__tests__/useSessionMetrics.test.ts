/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionMetrics } from '../useSessionMetrics';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { getFillerTotal } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';

describe('useSessionMetrics', () => {
    describe('formattedTime', () => {
        it('formats 0 seconds as 00:00', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', chunks: [], fillerData: {}, elapsedTime: 0 })
            );
            expect(result.current.formattedTime).toBe('00:00');
        });

        it('formats 65 seconds as 01:05', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', chunks: [], fillerData: {}, elapsedTime: 65 })
            );
            expect(result.current.formattedTime).toBe('01:05');
        });

        it('formats 3661 seconds as 61:01', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', chunks: [], fillerData: {}, elapsedTime: 3661 })
            );
            expect(result.current.formattedTime).toBe('61:01');
        });
    });

    describe('wpm (words per minute)', () => {
        it('returns 0 when elapsed time is 0', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'hello world',
                    chunks: [],
                    fillerData: {},
                    elapsedTime: 0
                })
            );
            expect(result.current.wpm).toBe(0);
        });

        it('calculates WPM correctly', () => {
            // 10 words in 30 seconds = (10/30) * 60 = 20 WPM
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    chunks: [],
                    fillerData: {},
                    elapsedTime: 30
                })
            );
            expect(result.current.wpm).toBe(20);
        });

        it('returns optimal label for 130-150 WPM', () => {
            // 140 words in 60 seconds = 140 WPM
            const words = Array(140).fill('word').join(' ');
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: words, chunks: [], fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.wpmLabel).toBe('Optimal Range');
        });

        it('returns Too Fast for > 150 WPM', () => {
            // 160 words in 60 seconds = 160 WPM
            const words = Array(160).fill('word').join(' ');
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: words, chunks: [], fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.wpmLabel).toBe('Too Fast');
        });
    });

    describe('clarityScore', () => {
        it('does not score empty transcripts as excellent clarity', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({ transcript: '', chunks: [], fillerData: {}, elapsedTime: 60 })
            );
            expect(result.current.clarityScore).toBe(0);
            expect(result.current.isClarityScorable).toBe(false);
            expect(result.current.clarityLabel).toBe('Not enough reliable speech to score');
            expect(result.current.clarityExplanation).toContain('No transcript was captured');
        });

        it('calculates clarity score correctly with fillers', () => {
            // 10 words, 2 fillers = 20% fillers
            // Penalty = 20 * 1.5 = 30 points off + max slow-pace penalty 15 -> 55 clarity
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    chunks: [],
                    fillerData: {
                        um: { count: 1, color: '#FCA5A5' },
                        uh: { count: 1, color: '#BFDBFE' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.clarityScore).toBe(55);
            expect(result.current.clarityLabel).toBe('Keep practicing');
        });

        it('returns Keep practicing for low clarity', () => {
            // 10 words, 5 fillers = 50% fillers
            // Penalty = 50 * 1.5 = 75 points off + max slow-pace penalty 15 -> 10 clarity
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'one two three four five six seven eight nine ten',
                    chunks: [],
                    fillerData: {
                        um: { count: 3, color: '#FCA5A5' },
                        uh: { count: 2, color: '#BFDBFE' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.clarityScore).toBe(10);
            expect(result.current.clarityLabel).toBe('Keep practicing');
        });

        it('penalizes pace that is too fast so clarity is not generic', () => {
            const words = Array(240).fill('word').join(' ');
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: words,
                    chunks: [],
                    fillerData: {},
                    elapsedTime: 60
                })
            );

            expect(result.current.wpm).toBe(240);
            expect(result.current.clarityScore).toBeLessThan(100);
            expect(result.current.clarityLabel).not.toBe('Excellent clarity!');
        });
    });

    describe('fillerCount', () => {
        it('headline counts the TRUE-filler tier (um/uh/ah); discourse markers are excluded by default (#1231)', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'test',
                    chunks: [],
                    fillerData: {
                        um: { count: 3, color: '#FCA5A5' },
                        uh: { count: 2, color: '#BFDBFE' },
                        like: { count: 5, color: '#FDE68A' } // discourse marker — NOT in the default headline
                    },
                    elapsedTime: 60
                })
            );
            // um(3) + uh(2) = 5; "like" (5) is a discourse marker, excluded from the default headline.
            expect(result.current.fillerCount).toBe(5);
        });
    });
});

describe('useSessionMetrics — LIVE filler count is canonical (no runtime source-selection to recount)', () => {
    // Live counter reports 4 fillers; the transcript itself has 0 (a clean re-decode). If ANY recount path
    // existed (PostHog/env/runtime flag), the visible count would collapse to 0 — it must stay 4 (live).
    const props = {
        transcript: 'the plan is ready for the board',
        chunks: [],
        fillerData: { total: { count: 4, color: '' }, um: { count: 4, color: '' } } as never,
        elapsedTime: 20,
    };

    it('#1/#2: filler count + detail rows come from the LIVE counter; a transcript recount is NOT used', () => {
        // Sanity: the transcript recount would be 0 here — so a count of 4 proves the hook is NOT recounting.
        expect(countFillerWords(props.transcript).total.count).toBe(0);
        const { result } = renderHook(() => useSessionMetrics(props));
        expect(result.current.fillerCount).toBe(4);                 // live 4, never the recount 0
        expect(result.current.fillerData).toBe(props.fillerData);   // live detail rows (same object)
        expect(result.current.fillerData.um?.count).toBe(4);
        expect(getFillerTotal(result.current.fillerData)).toBe(result.current.fillerCount); // coherent
    });

    it('#3: passing userWords cannot route the source to a recount (userWords is inert for source selection)', () => {
        const withWords = renderHook(() => useSessionMetrics({ ...props, userWords: ['honestly', 'um', 'the'] }));
        const withoutWords = renderHook(() => useSessionMetrics({ ...props, userWords: [] }));
        expect(withWords.result.current.fillerCount).toBe(4);
        expect(withoutWords.result.current.fillerCount).toBe(4);
        expect(withWords.result.current.fillerData).toBe(props.fillerData); // still the live object
    });

    it('#4: clarity + SpeakSharp Score consume the LIVE filler count, not a recount', () => {
        const clarityProps = {
            transcript: 'one two three four five six seven eight nine ten eleven twelve',
            chunks: [],
            fillerData: { total: { count: 4, color: '' }, um: { count: 4, color: '' } } as never,
            elapsedTime: 60,
        };
        const live = renderHook(() => useSessionMetrics(clarityProps));
        // Same transcript with a live ZERO → clarity differs, proving clarity used the live count (4), not text.
        const zero = renderHook(() => useSessionMetrics({ ...clarityProps, fillerData: { total: { count: 0, color: '' } } as never }));
        expect(live.result.current.clarityScore).not.toBe(zero.result.current.clarityScore);
        // Score consumes this hook's fillerCount + clarityScore.
        const score = calculateSpeakingScore({
            transcript: clarityProps.transcript, wordCount: live.result.current.wordCount, wpm: live.result.current.wpm,
            clarityScore: live.result.current.clarityScore, fillerCount: live.result.current.fillerCount,
            elapsedSeconds: clarityProps.elapsedTime, engine: 'private',
        }).score;
        expect(typeof score).toBe('number');
        expect(live.result.current.fillerCount).toBe(4); // the score's filler input is the live 4
    });

    it('#5: a valid live ZERO stays zero even when the transcript text contains filler words', () => {
        const zeroLiveWithFillersInText = {
            transcript: 'um uh like so basically the words keep going for reliable scoring now',
            chunks: [],
            fillerData: { total: { count: 0, color: '' } } as never, // canonical live zero
            elapsedTime: 20,
        };
        expect(countFillerWords(zeroLiveWithFillersInText.transcript).total.count).toBeGreaterThan(0); // recount would be > 0
        const { result } = renderHook(() => useSessionMetrics(zeroLiveWithFillersInText));
        expect(result.current.fillerCount).toBe(0); // stays zero — no recount substitution
    });
});
