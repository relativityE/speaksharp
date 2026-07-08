/* @vitest-environment jsdom */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionMetrics } from '../useSessionMetrics';
import { __setFillerRecountSsotForTests } from '@/services/telemetry/fillerSsotFlag';
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
        it('sums all filler word counts', () => {
            const { result } = renderHook(() =>
                useSessionMetrics({
                    transcript: 'test',
                    chunks: [],
                    fillerData: {
                        um: { count: 3, color: '#FCA5A5' },
                        uh: { count: 2, color: '#BFDBFE' },
                        like: { count: 5, color: '#FDE68A' }
                    },
                    elapsedTime: 60
                })
            );
            expect(result.current.fillerCount).toBe(10);
        });
    });
});

describe('useSessionMetrics — Phase 5.8 APPLY: transcript-recount filler SSOT flag', () => {
    // Live counter reports 4 fillers; the transcript itself has 0 (a clean Private re-decode).
    const props = {
        transcript: 'the plan is ready for the board',
        chunks: [],
        fillerData: { total: { count: 4, color: '' }, um: { count: 4, color: '' } } as never,
        elapsedTime: 20,
    };

    afterEach(() => { __setFillerRecountSsotForTests(null); });

    it('flag OFF (default): aggregate count AND detail rows BOTH come from the LIVE counter — unchanged', () => {
        __setFillerRecountSsotForTests(false);
        const { result } = renderHook(() => useSessionMetrics(props));
        expect(result.current.fillerCount).toBe(4);                 // live count
        expect(result.current.fillerData).toBe(props.fillerData);   // live detail rows (same object) — byte-identical
        expect(result.current.fillerData.um?.count).toBe(4);
        expect(getFillerTotal(result.current.fillerData)).toBe(result.current.fillerCount); // coherent
    });

    it('flag ON: aggregate count AND detail rows BOTH come from the transcript RECOUNT (coherent)', () => {
        __setFillerRecountSsotForTests(true);
        const { result } = renderHook(() => useSessionMetrics(props));
        expect(result.current.fillerCount).toBe(0);
        // Detail data is recount-derived and coherent with the count — the live um:4 row is gone.
        expect(getFillerTotal(result.current.fillerData)).toBe(result.current.fillerCount);
        expect(result.current.fillerData.um?.count ?? 0).toBe(0);
    });

    it('flag ON preserves custom userWords in BOTH the count and the detail rows', () => {
        __setFillerRecountSsotForTests(true);
        const custom = { transcript: 'honestly this is honestly good', chunks: [], fillerData: {} as never, elapsedTime: 10 };
        const withWords = renderHook(() => useSessionMetrics({ ...custom, userWords: ['honestly'] }));
        const withoutWords = renderHook(() => useSessionMetrics({ ...custom, userWords: [] }));
        expect(withWords.result.current.fillerCount).toBe(2);   // "honestly" ×2
        expect(withWords.result.current.fillerData.honestly?.count).toBe(2); // custom-word DETAIL row present
        expect(getFillerTotal(withWords.result.current.fillerData)).toBe(2);
        expect(withoutWords.result.current.fillerCount).toBe(0); // no static fillers
    });

    it('flag ON: Private finalize-replacement — live um:4 does NOT appear in the ON detail rows', () => {
        __setFillerRecountSsotForTests(true);
        const { result } = renderHook(() => useSessionMetrics(props));
        expect(result.current.fillerCount).toBe(0);           // 0, not the live 4
        expect(result.current.fillerData.um?.count ?? 0).not.toBe(4); // no contradictory um:4 detail row
        expect(getFillerTotal(result.current.fillerData)).toBe(0);
    });

    it('flag ON: Cloud overlap — double-counted live fillers collapse to the recount', () => {
        __setFillerRecountSsotForTests(true);
        const cloud = { transcript: 'so the launch is basically ready', chunks: [], fillerData: { total: { count: 4, color: '' } } as never, elapsedTime: 15 };
        const { result } = renderHook(() => useSessionMetrics(cloud));
        expect(result.current.fillerCount).toBe(countFillerWords(cloud.transcript).total.count); // 2 (so, basically)
        expect(result.current.fillerCount).toBe(2);
        expect(getFillerTotal(result.current.fillerData)).toBe(2); // detail rows coherent with the count
    });

    it('clarity AND score consume the flag-selected filler source', () => {
        __setFillerRecountSsotForTests(false);
        const off = renderHook(() => useSessionMetrics(props));
        __setFillerRecountSsotForTests(true);
        const on = renderHook(() => useSessionMetrics(props));

        // Clarity moves because it is computed from the selected filler count.
        expect(on.result.current.clarityScore).not.toBe(off.result.current.clarityScore);

        // The SpeakSharp Score consumes this hook's clarityScore + fillerCount (SessionPage passes them to
        // LiveCoachingScoreCard), so it inherits the selected source too.
        const scoreFor = (m: { fillerCount: number; clarityScore: number; wpm: number; wordCount: number }) =>
            calculateSpeakingScore({ transcript: props.transcript, wordCount: m.wordCount, wpm: m.wpm, clarityScore: m.clarityScore, fillerCount: m.fillerCount, elapsedSeconds: props.elapsedTime, engine: 'private' }).score;
        expect(scoreFor(on.result.current)).not.toBe(scoreFor(off.result.current));
    });
});
