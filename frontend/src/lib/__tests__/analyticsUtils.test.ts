import { describe, it, expect } from 'vitest';
import { calculateOverallStats, calculateFillerWordTrends, calculateAccuracyData, calculateTopFillerWords, getSessionPauseCount } from '../analyticsUtils';
import { PracticeSession } from '@/types/session';

const mockSessionHistory: PracticeSession[] = [
    {
        id: '1',
        created_at: '2023-10-27T10:00:00.000Z',
        user_id: 'user-1',
        duration: 300,
        total_words: 500,
        filler_words: { um: { count: 5 }, uh: { count: 3 }, total: { count: 8 } },
        accuracy: 0.95,
        clarity_score: 95,
        title: 'Session 1',
        transcript: '... um ... uh ...',
        pause_metrics: { silencePercentage: 10, transitionPauses: 8, extendedPauses: 2, longestPause: 2 },
    },
    {
        id: '2',
        created_at: '2023-10-26T10:00:00.000Z',
        user_id: 'user-1',
        duration: 600,
        total_words: 1000,
        filler_words: { um: { count: 10 }, like: { count: 5 }, total: { count: 15 } },
        accuracy: 0.90,
        clarity_score: 90,
        title: 'Session 2',
        transcript: '... um ... like ...',
        pause_metrics: { silencePercentage: 12, transitionPauses: 15, extendedPauses: 5, longestPause: 3 },
    },
];

describe('analyticsUtils', () => {
    describe('calculateOverallStats', () => {
        it('should calculate overall stats correctly', () => {
            const stats = calculateOverallStats(mockSessionHistory);
            expect(stats.totalSessions).toBe(2);
            expect(stats.totalPracticeTime).toBe(15);
            expect(stats.averageWPM).toBe(100);
            expect(stats.avgFillerWordsPerMin).toBe('1.5');
            expect(stats.avgClarity).toBe('92.5');
            // Pause Rhythm: (8+2) + (15+5) = 30 pauses over 15 speaking minutes = 2.0/min.
            expect(stats.avgPausesPerMin).toBe('2.0');
        });

        it('aggregates Pause Rhythm (pauses/min) from short + long pauses, and is UNKNOWN without pause data', () => {
            // getSessionPauseCount = transitionPauses + extendedPauses.
            expect(getSessionPauseCount(mockSessionHistory[0])).toBe(10);
            expect(getSessionPauseCount(mockSessionHistory[1])).toBe(20);
            // The per-session helper still contributes 0 for a missing block (no crash, no NaN)...
            expect(getSessionPauseCount({ id: 'x' } as PracticeSession)).toBe(0);
            // ...but #1045: the AGGREGATE must not present that absence as the rate 0.0. No session
            // carried pause_metrics, so the rhythm is unknown — reporting "0.0/min" (which the card
            // then decoded to the judgment "Sparse") was a claim about speech we never measured.
            expect(calculateOverallStats([
                { id: 'no-pauses', created_at: '2026-01-01T00:00:00.000Z', user_id: 'u', duration: 60, total_words: 60, filler_words: {}, transcript: 'word '.repeat(60) },
            ] as PracticeSession[]).avgPausesPerMin).toBeNull();
        });

        it('aggregates Clear Delivery (clarity) from clarity_score and ignores the unrelated STT accuracy field', () => {
            // Regression for the aggregate-Clarity-0% bug: a session can have accuracy=0 (or absent)
            // while clarity_score is high. The aggregate must reflect clarity_score, not STT accuracy.
            const stats = calculateOverallStats([
                {
                    id: 'mismatch',
                    created_at: '2026-01-01T00:00:00.000Z',
                    user_id: 'user-1',
                    duration: 120,
                    total_words: 200,
                    transcript: Array.from({ length: 200 }, (_, i) => `word${i}`).join(' '),
                    filler_words: {},
                    accuracy: 0,
                    clarity_score: 85,
                    title: 'Accuracy 0, Clarity 85',
                },
            ] as PracticeSession[]);

            expect(stats.avgClarity).toBe('85.0');
        });

        it('uses aggregate words over aggregate time so short sessions do not distort average WPM', () => {
            const stats = calculateOverallStats([
                {
                    id: 'short-fast',
                    created_at: '2026-05-24T12:00:00.000Z',
                    user_id: 'user-1',
                    duration: 10,
                    total_words: 40,
                    transcript: Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '),
                    filler_words: {},
                    title: 'Short fast session',
                },
                {
                    id: 'long-normal',
                    created_at: '2026-05-24T12:10:00.000Z',
                    user_id: 'user-1',
                    duration: 110,
                    total_words: 110,
                    transcript: Array.from({ length: 110 }, (_, index) => `word${index}`).join(' '),
                    filler_words: {},
                    title: 'Long normal session',
                },
            ] as PracticeSession[]);

            expect(stats.averageWPM).toBe(75);
        });
    });

    describe('calculateFillerWordTrends', () => {
        it('normalizes filler word trends by speaking time', () => {
            const trends = calculateFillerWordTrends(mockSessionHistory);
            expect(trends.um.current).toBe(1); // 15 ums / 15 speaking minutes
            expect(trends.um.previous).toBe(0);
            expect(trends.uh.current).toBe(0.2); // 3 uhs / 15 speaking minutes
            expect(trends.uh.previous).toBe(0);
            expect(trends.like.current).toBe(0.33); // 5 likes / 15 speaking minutes
            expect(trends.like.previous).toBe(0);
        });
    });

    describe('calculateAccuracyData', () => {
        it('should return accuracy as rounded percentage', () => {
            const history: PracticeSession[] = [{
                id: '3',
                user_id: 'user-1',
                created_at: '2023-10-25T10:00:00.000Z',
                ground_truth: 'hello world',
                transcript: 'hello word', // 1 substitution, 2 words total. WER = 0.5. Accuracy = 50%
                engine: 'Private',
                duration: 10,
                total_words: 2,
                filler_words: {}
            } as unknown as PracticeSession];

            const result = calculateAccuracyData(history);
            expect(result).toHaveLength(1);
            expect(result[0].accuracy).toBe(50);
        });

        it('should handle fractional accuracy correctly with rounding', () => {
            const history: PracticeSession[] = [{
                id: '4',
                user_id: 'user-1',
                created_at: '2023-10-24T10:00:00.000Z',
                ground_truth: 'the quick brown fox',
                transcript: 'the quick brown fix', // 1 sub, 4 words. WER = 0.25. Accuracy = 75%
                engine: 'Cloud AI',
                duration: 10,
                total_words: 4,
                filler_words: {}
            } as unknown as PracticeSession];

            const result = calculateAccuracyData(history);
            expect(result[0].accuracy).toBe(75);
        });
    });

    describe('calculateTopFillerWords', () => {
        it('correctly aggregates filler words and returns sorted results', () => {
            const sessionHistory = [
                {
                    // #1047: genuine captured sessions (transcript_state 'available') so the aggregation logic
                    // is what's under test, not the provenance gate.
                    transcript_state: 'available',
                    filler_words: {
                        um: { count: 10 },
                        like: { count: 5 },
                        total: { count: 15 }
                    }
                },
                {
                    transcript_state: 'available',
                    filler_words: {
                        um: { count: 5 },
                        basically: { count: 20 },
                        total: { count: 25 }
                    }
                }
            ] as Partial<PracticeSession>[] as PracticeSession[];

            const result = calculateTopFillerWords(sessionHistory);

            expect(result).toEqual([
                { word: 'basically', count: 20 },
                { word: 'um', count: 15 },
                { word: 'like', count: 5 }
            ]);
        });

        it('ignores "total" keyword', () => {
            const sessionHistory = [
                {
                    filler_words: {
                        total: { count: 100 }
                    }
                }
            ] as Partial<PracticeSession>[] as PracticeSession[];

            const result = calculateTopFillerWords(sessionHistory);
            expect(result.find(r => r.word === 'total')).toBeUndefined();
        });

        it('handles empty session history', () => {
            const result = calculateTopFillerWords([]);
            expect(result).toEqual([]);
        });

        it('handles sessions with no filler words', () => {
            const sessionHistory = [
                { id: '1' }
            ] as Partial<PracticeSession>[] as PracticeSession[];
            const result = calculateTopFillerWords(sessionHistory);
            expect(result).toEqual([]);
        });
    });
});

describe('(#1047) transcript provenance — not_captured excluded from every transcript-derived aggregate', () => {
    // Two genuine sessions (no server state → derived available) + one not_captured row carrying LARGE stale
    // words/fillers/clarity/accuracy. Every transcript-derived aggregate on the mixed history must EQUAL the
    // valid-only result; only total practice TIME is allowed to include the not_captured row's duration.
    const validOnly: PracticeSession[] = mockSessionHistory;
    const notCaptured: PracticeSession = {
        id: 'nc', created_at: '2023-10-28T10:00:00.000Z', user_id: 'user-1',
        duration: 600, total_words: 9999, clarity_score: 99, accuracy: 0.99,
        filler_words: { um: { count: 999 }, total: { count: 999 } },
        title: 'Never captured', transcript: '', transcript_state: 'not_captured',
        pause_metrics: { silencePercentage: 0, transitionPauses: 0, extendedPauses: 0, longestPause: 0 },
    };
    const mixed: PracticeSession[] = [...validOnly, notCaptured];

    it('overall rates (WPM, filler rate, clarity) equal the valid-only result', () => {
        const v = calculateOverallStats(validOnly);
        const m = calculateOverallStats(mixed);
        expect(m.averageWPM).toBe(v.averageWPM);                       // 100 — stale 9999 words excluded
        expect(m.avgFillerWordsPerMin).toBe(v.avgFillerWordsPerMin);   // '1.5' — stale 999 fillers excluded
        expect(m.avgClarity).toBe(v.avgClarity);                       // '92.5' — stale clarity 99 excluded
    });

    it('total practice TIME stays all-session (the one metric that includes not_captured duration)', () => {
        const v = calculateOverallStats(validOnly);
        const m = calculateOverallStats(mixed);
        expect(v.totalPracticeTime).toBe(15);                          // 900s
        expect(m.totalPracticeTime).toBe(25);                         // 900s + 600s = 1500s = 25 min
        expect(m.totalSessions).toBe(3);                              // the not_captured row is still a session
    });

    it('top fillers, filler trends and chart points exclude the not_captured stale counts', () => {
        expect(calculateTopFillerWords(mixed)).toEqual(calculateTopFillerWords(validOnly));
        expect(calculateFillerWordTrends(mixed)).toEqual(calculateFillerWordTrends(validOnly));
        // The not_captured chart point (most recent) carries null rate + null clarity, never stale values.
        const ncPoint = calculateOverallStats(mixed).chartData.find(p => p.date === new Date(notCaptured.created_at).toLocaleDateString());
        expect(ncPoint?.['FW/min']).toBeNull();
        expect(ncPoint?.clarity).toBeNull();
    });

    it('accuracy series excludes a not_captured row even with retained accuracy/transcript', () => {
        const validAcc: PracticeSession = {
            id: 'va', created_at: '2023-10-27T10:00:00.000Z', user_id: 'user-1', duration: 60,
            total_words: 4, engine: 'private-v2', ground_truth: 'the quick brown fox',
            transcript: 'the quick brown fox', accuracy: 0.95, transcript_state: 'available',
        };
        const ncAcc: PracticeSession = {
            id: 'nca', created_at: '2023-10-28T10:00:00.000Z', user_id: 'user-1', duration: 60,
            total_words: 4, engine: 'private-v2', ground_truth: 'the quick brown fox',
            transcript: 'totally different stale words', accuracy: 0.10, transcript_state: 'not_captured',
        };
        expect(calculateAccuracyData([validAcc, ncAcc])).toEqual(calculateAccuracyData([validAcc]));
        expect(calculateAccuracyData([validAcc, ncAcc])).toHaveLength(1);
    });
});
