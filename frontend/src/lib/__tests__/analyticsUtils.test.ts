import { describe, it, expect } from 'vitest';
import * as analyticsUtils from '../analyticsUtils';
import { calculateOverallStats, calculateFillerWordTrends, calculateTopFillerWords, getSessionPauseCount } from '../analyticsUtils';
import type { AnalyticsSummary } from '@/types/analytics';
import { PracticeSession } from '@/types/session';

const mockSessionHistory: PracticeSession[] = [
    {
        id: '1',
        created_at: '2023-10-27T10:00:00.000Z',
        user_id: 'user-1',
        duration: 300,
        total_words: 500,
        filler_counts: { um: 5, uh: 3 },
        clarity_score: 95,
        title: 'Session 1',
        pause_metrics: { silencePercentage: 10, transitionPauses: 8, extendedPauses: 2, longestPause: 2 },
    },
    {
        id: '2',
        created_at: '2023-10-26T10:00:00.000Z',
        user_id: 'user-1',
        duration: 600,
        total_words: 1000,
        filler_counts: { um: 10, like: 5 },
        clarity_score: 90,
        title: 'Session 2',
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
                { id: 'no-pauses', created_at: '2026-01-01T00:00:00.000Z', user_id: 'u', duration: 60, total_words: 60, filler_counts: {} },
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
                    filler_counts: {},
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
                    filler_counts: {},
                    title: 'Short fast session',
                },
                {
                    id: 'long-normal',
                    created_at: '2026-05-24T12:10:00.000Z',
                    user_id: 'user-1',
                    duration: 110,
                    total_words: 110,
                    filler_counts: {},
                    title: 'Long normal session',
                },
            ] as PracticeSession[]);

            expect(stats.averageWPM).toBe(75);
        });
    });

    describe('calculateFillerWordTrends', () => {
        it('normalizes filler word trends by speaking time across TWO nonempty windows', () => {
            // #1131 correction 2: two eligible measurements split into two nonempty windows (never a zero
            // baseline). current = most-recent S1 (5 min: um 5, uh 3); previous = older S2 (10 min: um 10,
            // like 5). Rates are per speaking minute within each window.
            const trends = calculateFillerWordTrends(mockSessionHistory);
            expect(trends.um.current).toBe(1);       // 5 ums / 5 min (S1)
            expect(trends.um.previous).toBe(1);      // 10 ums / 10 min (S2) — a REAL prior value, not 0
            expect(trends.uh.current).toBe(0.6);     // 3 uhs / 5 min (S1)
            expect(trends.uh.previous).toBe(0);      // S2 had no "uh"
            expect(trends.like.current).toBe(0);     // S1 had no "like"
            expect(trends.like.previous).toBe(0.5);  // 5 likes / 10 min (S2)
        });
    });

    describe('#1306 UNAVAILABLE/INVALID filler data is excluded — never a fabricated zero', () => {
        const measured: PracticeSession = {
            id: 'm', created_at: '2026-08-01T10:00:00.000Z', user_id: 'user-1',
            duration: 60, total_words: 120, filler_counts: { um: 6 }, clarity_score: 90,
        };
        it('does NOT improve (dilute) the filler-rate average', () => {
            const base = calculateOverallStats([measured]).avgFillerWordsPerMin; // 6 fillers / 1 min = '6.0'
            expect(base).toBe('6.0');
            const unavailable = { ...measured, id: 'u', filler_counts: undefined } as unknown as PracticeSession;
            const invalid = { ...measured, id: 'i', filler_counts: { 'a prose phrase': 1 } } as unknown as PracticeSession;
            // Adding an unavailable/invalid row must NOT dilute 6.0 to a flattering 3.0 — it is excluded.
            expect(calculateOverallStats([measured, unavailable]).avgFillerWordsPerMin).toBe(base);
            expect(calculateOverallStats([measured, invalid]).avgFillerWordsPerMin).toBe(base);
        });
        it('does NOT enter the trend denominator (an unavailable row leaves a single eligible point → no trend)', () => {
            const unavailable = { ...measured, id: 'u', created_at: '2026-08-02T10:00:00.000Z', filler_counts: undefined } as unknown as PracticeSession;
            expect(calculateFillerWordTrends([measured, unavailable])).toEqual({}); // 1 eligible ≠ a trend
        });
    });

    describe('#1306: customer STT accuracy is REMOVED (no function, no field)', () => {
        it('exposes no calculateAccuracyData export — the customer accuracy series is gone, not stubbed', () => {
            expect((analyticsUtils as Record<string, unknown>).calculateAccuracyData).toBeUndefined();
        });
        it('the analytics summary contract carries no customer accuracyData field', () => {
            // Type-level guard: a summary object with an accuracyData field is not assignable to AnalyticsSummary.
            const summary = { overallStats: {}, fillerWordTrends: {}, topFillerWords: [], weeklySessionsCount: 0, weeklyActivity: [] } as unknown as AnalyticsSummary;
            expect((summary as unknown as Record<string, unknown>).accuracyData).toBeUndefined();
        });
    });

    describe('calculateTopFillerWords', () => {
        it('correctly aggregates filler words and returns sorted results', () => {
            const sessionHistory = [
                {
                    // is what's under test, not the provenance gate.
                    filler_counts: {
                        um: 10,
                        like: 5
                    }
                },
                {
                    filler_counts: {
                        um: 5,
                        basically: 20
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
                    filler_counts: {
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

describe('#1306 metric-presence provenance — a metric is included iff its OWN value is persisted', () => {
    // Two genuine sessions + one row whose metrics are NOT MEASURED (null filler_counts / null total_words /
    // null clarity). A metric is contributed only when its own value is present — the unmeasured row falls out
    // of every rate but still counts toward total practice TIME.
    const validOnly: PracticeSession[] = mockSessionHistory;
    const unmeasured: PracticeSession = {
        id: 'nm', created_at: '2023-10-28T10:00:00.000Z', user_id: 'user-1',
        duration: 600, // real elapsed time, but nothing measured
        filler_counts: undefined, total_words: undefined, clarity_score: undefined,
        title: 'Unmeasured',
    };
    const mixed: PracticeSession[] = [...validOnly, unmeasured];

    it('overall rates (WPM, filler rate, clarity) equal the measured-only result — the unmeasured row is excluded', () => {
        const v = calculateOverallStats(validOnly);
        const m = calculateOverallStats(mixed);
        expect(m.averageWPM).toBe(v.averageWPM);                       // 100
        expect(m.avgFillerWordsPerMin).toBe(v.avgFillerWordsPerMin);   // '1.5'
        expect(m.avgClarity).toBe(v.avgClarity);                       // '92.5'
    });

    it('total practice TIME stays all-session (the one metric that includes an unmeasured row duration)', () => {
        const v = calculateOverallStats(validOnly);
        const m = calculateOverallStats(mixed);
        expect(v.totalPracticeTime).toBe(15);                          // 900s
        expect(m.totalPracticeTime).toBe(25);                          // 900s + 600s = 1500s = 25 min
        expect(m.totalSessions).toBe(3);                               // the unmeasured row is still a session
    });

    it('top fillers, filler trends and chart points exclude an unmeasured (null filler) row', () => {
        expect(calculateTopFillerWords(mixed)).toEqual(calculateTopFillerWords(validOnly));
        expect(calculateFillerWordTrends(mixed)).toEqual(calculateFillerWordTrends(validOnly));
        const nmPoint = calculateOverallStats(mixed).chartData.find(p => p.date === new Date(unmeasured.created_at).toLocaleDateString());
        expect(nmPoint?.['FW/min']).toBeNull();
        expect(nmPoint?.clarity).toBeNull();
    });

    it('a MEASURED zero ({}) filler row IS included (counts as a genuine 0 in the denominator)', () => {
        // One measured-zero row over 1 minute → 0 fillers / 1 min contributes a real 0.0/min data point; it is
        // a filler-rate CONTRIBUTOR (unlike a null/unmeasured row, which is excluded).
        const zeroRow: PracticeSession = {
            id: 'z', created_at: '2023-10-29T10:00:00.000Z', user_id: 'user-1', duration: 60,
            total_words: 100, filler_counts: {}, clarity_score: 90,
        };
        const stats = calculateOverallStats([zeroRow]);
        expect(stats.avgFillerWordsPerMin).toBe('0.0'); // measured zero → a real 0.0/min, not "unavailable"
    });
});

describe('(#1047 U1) metric-specific evidence + >=2 filler-trend gate — client falsification', () => {
    // Each fixture is built so the OLD blanket rule (one shared eligible-duration for every rate) would yield
    // a DIFFERENT, provably-wrong number than the corrected per-metric rule.
    const avail = (over: Partial<PracticeSession> = {}): PracticeSession => ({
        id: 'a', created_at: '2026-07-01T10:00:00.000Z', user_id: 'user-1', duration: 60,
        total_words: 120, clarity_score: 88,
        filler_counts: { um: 2 },
        pause_metrics: { silencePercentage: 0, transitionPauses: 1, extendedPauses: 0, longestPause: 0 },
        ...over,
    });

    it('an EXPIRED row with words but NO persisted filler counts toward WPM only — never the filler rate', () => {
        // WPM sees both rows (240 words / 2 min = 120). Filler sees only the available row (2 / 1 = 2.0).
        // The old shared denominator would report 2 fillers / 2 min = 1.0 — the falsified wrong answer.
        const rows: PracticeSession[] = [
            avail(),
            avail({ id: 'e', created_at: '2026-07-02T10:00:00.000Z', total_words: 120, clarity_score: 84, filler_counts: undefined }),
        ];
        const m = calculateOverallStats(rows);
        expect(m.averageWPM).toBe(120);
        expect(m.avgFillerWordsPerMin).toBe('2.0');   // NOT 1.0
    });

    it('an EXPIRED row with fillers but NO persisted words counts toward the filler rate only — never WPM', () => {
        // Filler sees both rows (6 / 2 min = 3.0). WPM sees only the available row (120 / 1 min = 120).
        // The old shared denominator would report 120 words / 2 min = 60 WPM — the falsified wrong answer.
        const rows: PracticeSession[] = [
            avail(),
            avail({ id: 'e', created_at: '2026-07-02T10:00:00.000Z', total_words: undefined, clarity_score: undefined,
                    filler_counts: { um: 4 } }),
        ];
        const m = calculateOverallStats(rows);
        expect(m.averageWPM).toBe(120);               // NOT 60
        expect(m.avgFillerWordsPerMin).toBe('3.0');
    });

    it('reports NO filler trend from a SINGLE eligible measurement (>=2 gate)', () => {
        // The second row is NOT filler-measured (null filler_counts) → excluded → exactly ONE eligible point.
        const rows: PracticeSession[] = [
            avail(),
            avail({ id: 'nm', created_at: '2026-07-02T10:00:00.000Z', filler_counts: undefined }),
        ];
        expect(calculateFillerWordTrends(rows)).toEqual({});   // one eligible point ≠ a trend
    });

    it('DOES report a filler trend once there are TWO eligible measurements (>=2 gate)', () => {
        const rows: PracticeSession[] = [
            avail({ id: 'a1', created_at: '2026-07-01T10:00:00.000Z', filler_counts: { um: 3 } }),
            avail({ id: 'a2', created_at: '2026-07-02T10:00:00.000Z', filler_counts: { um: 6 } }),
        ];
        expect(Object.keys(calculateFillerWordTrends(rows)).length).toBeGreaterThan(0);
    });

    it('DOES report a filler trend once there are >=2 eligible measurements', () => {
        const rows: PracticeSession[] = [
            avail(),
            avail({ id: 'a2', created_at: '2026-07-02T10:00:00.000Z',
                    filler_counts: { um: 6 } }),
        ];
        expect(Object.keys(calculateFillerWordTrends(rows))).toContain('um');
    });
});
