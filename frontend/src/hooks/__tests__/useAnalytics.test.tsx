import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { useAnalytics } from '../useAnalytics';
import { usePracticeHistory } from '../usePracticeHistory';
import { useSession } from '../useSession';
import { useParams } from 'react-router-dom';
import { useAuthProvider } from '../../contexts/AuthProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAnalyticsSummary, getSessionCount } from '../../lib/storage';

// Mock dependencies
vi.mock('../usePracticeHistory');
vi.mock('../useSession');
vi.mock('../../lib/storage', () => ({
    getAnalyticsSummary: vi.fn(),
    getSessionCount: vi.fn(),
}));
vi.mock('../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
    useParams: vi.fn(),
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** #1472: all-time numbers exist only inside a `complete` aggregate; anything else fails the read loudly. */
type HookResult = { current: ReturnType<typeof useAnalytics> };
const statsOf = (result: HookResult) => {
    const a = result.current.allTime;
    if (a.status !== 'complete') throw new Error(`allTime is ${a.status}${a.status === 'unavailable' ? ` (${a.reason})` : ''}`);
    return a.stats;
};

describe('useAnalytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
        window.history.pushState({}, '', '/analytics');
        window.sessionStorage.clear();
        (useParams as Mock).mockReturnValue({});
        (useSession as Mock).mockReturnValue({ data: null, isLoading: false });
        (useAuthProvider as unknown as Mock).mockReturnValue({ user: { id: 'test-user' } });
    });

    it('should process analytics data correctly from usePracticeHistory', async () => {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        const mockSessions = [
            {
                id: 's1',
                created_at: now.toISOString(),
                duration: 60,
                total_words: 100,
                filler_counts: { um: 5, uh: 3 },
                engine: 'Private',
            },
            {
                id: 's2',
                created_at: yesterday.toISOString(),
                duration: 120,
                total_words: 200,
                filler_counts: { um: 10, like: 5 },
                engine: 'Private',
            },
        ];

        (usePracticeHistory as Mock).mockReturnValue({
            data: mockSessions,
            isLoading: false,
            error: null
        });
        (getSessionCount as Mock).mockResolvedValue(mockSessions.length);

        const { result } = renderHook(() => useAnalytics(), { wrapper });

        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(null);
        expect(result.current.sessionHistory).toEqual(mockSessions);

        // Check derived stats
        expect(result.current.topFillerWords).toEqual([
            { word: 'um', count: 15 },
            { word: 'like', count: 5 },
            { word: 'uh', count: 3 },
        ]);

        await vi.waitFor(() => expect(result.current.allTime.status).toBe('complete'));
        expect(statsOf(result).totalSessions).toBe(2);
        expect(statsOf(result).totalPracticeTime).toBe(3); // 180s / 60 = 3m
        expect(result.current.weekly).toMatchObject({ status: 'complete', count: 2, activity: expect.any(Array) });
        expect((result.current.weekly as { activity: unknown[] }).activity).toHaveLength(7);
    });

    it('should filter sessions when sessionId is present in URL', async () => {
        const mockSessions = [
            { id: 's1', duration: 60, filler_counts: {} },
            { id: 's2', duration: 120, filler_counts: {} }
        ];

        (usePracticeHistory as Mock).mockReturnValue({
            data: mockSessions,
            isLoading: false,
            error: null
        });
        (getSessionCount as Mock).mockResolvedValue(mockSessions.length);

        (useParams as Mock).mockReturnValue({ sessionId: 's1' });

        const { result } = renderHook(() => useAnalytics(), { wrapper });

        expect(result.current.sessionHistory).toHaveLength(1);
        expect(result.current.sessionHistory[0].id).toBe('s1');
        // #1472: the session-detail view never fetches the count, so it never claims an all-time aggregate.
        expect(result.current.allTime.status).not.toBe('complete');
    });

    /**
     * #1045 correction batch, finding 3 — the RPC path (>20 sessions) must not lose valid duration.
     *
     * `get_analytics_summary` returns `totalPracticeTime` in ROUNDED MINUTES and `totalSessions`. It
     * has never returned `averageSessionLength` or any seconds field, so the old `|| 0` fallback
     * reported a confident "0 mins" for every history large enough to use this path — and naively
     * switching that to null would have discarded duration the RPC genuinely provides. The adapter
     * derives both canonical fields from the real contract.
     */
    describe('#1045 RPC summary path preserves valid duration', () => {
        const rpcSummary = (over: Record<string, unknown> = {}) => ({
            overallStats: {
                totalSessions: 40,
                totalPracticeTime: 200,      // rounded MINUTES, per the RPC contract
                avgWpm: 145,
                avgFillerWordsPerMin: '2.4',
                avgClarity: '81.5',
                avgAccuracy: '81.5',         // legacy alias of the same clarity value
                // #1091 v4 contract: how many sessions actually carried evidence for each aggregate.
                clarityContributorCount: 36,
                wpmContributorCount: 38,
                fillerRateContributorCount: 38,
                ...over,
            },
            fillerWordTrends: {},
            topFillerWords: [],
            chartData: [],
        });

        const renderWithRpc = async (summary: unknown) => {
            (usePracticeHistory as Mock).mockReturnValue({ sessions: [], loading: false, error: null });
            (getSessionCount as Mock).mockResolvedValue(40); // > 20 -> RPC path
            (getAnalyticsSummary as Mock).mockResolvedValue(summary);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(statsOf(result).totalSessions).toBe(40));
            return result;
        };

        it('derives duration in seconds from the minutes the RPC actually returns', async () => {
            const result = await renderWithRpc(rpcSummary());
            const stats = statsOf(result);
            expect(stats.totalPracticeTimeSeconds).toBe(200 * 60);
            expect(stats.averageSessionLengthSeconds).toBeCloseTo((200 * 60) / 40, 5);
            expect(stats.averageSessionLength).toBeCloseTo(200 / 40, 5);
        });

        it('maps the RPC clarity field instead of dropping Clear Delivery on this path', async () => {
            const result = await renderWithRpc(rpcSummary());
            expect(Number(statsOf(result).avgClarity)).toBeCloseTo(81.5, 5);
        });

        it('reports duration as unknown — never 0 mins — when the RPC returns no usable duration', async () => {
            const result = await renderWithRpc(rpcSummary({ totalPracticeTime: 0 }));
            const stats = statsOf(result);
            // Rounded minutes of 0 means the total is under 30s: real, but not expressible at this
            // precision. Unknown is honest; "0 mins" would repeat the defect this PR fixes.
            expect(stats.averageSessionLengthSeconds).toBeNull();
            expect(stats.averageSessionLength).toBeNull();
        });

        it('reports pause rhythm as unknown because the RPC does not compute it', async () => {
            const result = await renderWithRpc(rpcSummary());
            expect(statsOf(result).avgPausesPerMin).toBeNull();
        });

        /**
         * #1091 blocker: users past the >20-session threshold never touch `calculateOverallStats`, so
         * the client-side clarity fix does not reach them. The server aggregate is fixed in migration
         * 20260729130000; these tests pin the CONTRACT the hook must hold up at that boundary.
         */
        describe('#1091 RPC evidence-validity contract', () => {
            it('passes the real clarity average through when contributors exist', async () => {
                const result = await renderWithRpc(rpcSummary());
                expect(Number(statsOf(result).avgClarity)).toBeCloseTo(81.5, 5);
                expect(statsOf(result).averageWPM).toBe(145);
                expect(Number(statsOf(result).avgFillerWordsPerMin)).toBeCloseTo(2.4, 5);
            });

            it('prefers the explicit avgClarity key over the legacy avgAccuracy alias', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: '74.2', avgAccuracy: '81.5' }),
                );
                expect(Number(statsOf(result).avgClarity)).toBeCloseTo(74.2, 5);
            });

            it('still reads clarity from avgAccuracy when only the alias is populated', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: null, avgAccuracy: '77.0' }),
                );
                expect(Number(statsOf(result).avgClarity)).toBeCloseTo(77, 5);
            });

            it('reports clarity as unknown — not 0.0 — when zero sessions carry clarity evidence', async () => {
                // Every session lost its phase-2c metrics write: clarity_score is NULL everywhere.
                // The v4 RPC reports null + a zero contributor count; anything numeric here would be
                // the "Clear Delivery 0%" defect reappearing on the path that actually serves the user.
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: null, avgAccuracy: null, clarityContributorCount: 0 }),
                );
                expect(statsOf(result).avgClarity).toBeNull();
                expect(statsOf(result).avgClarity).not.toBe('0.0');
                expect(statsOf(result).avgClarity).not.toBe(0);
            });

            it('never resurrects a number from a stale value when the contributor count is 0', async () => {
                // Defensive: even if a server somehow returns both a zero count AND a number, the count
                // is the evidence of record. No contributors means no average.
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: '0.0', avgAccuracy: '0.0', clarityContributorCount: 0 }),
                );
                expect(statsOf(result).avgClarity).toBeNull();
            });

            it('degrades every guarded aggregate to unknown on a legacy/unmigrated RPC payload', async () => {
                // No contributor keys at all = the v3 function is still installed. Its numbers averaged
                // missing measurements in as zeros and cannot be repaired client-side, so the dashboard
                // must show "Not enough data" rather than a number known to be wrong.
                const legacy = {
                    overallStats: {
                        totalSessions: 40,
                        totalPracticeTime: 200,
                        avgWpm: 145,
                        avgFillerWordsPerMin: '2.4',
                        avgAccuracy: '31.2',
                    },
                    fillerWordTrends: {},
                    topFillerWords: [],
                    chartData: [],
                };
                const result = await renderWithRpc(legacy);
                const stats = statsOf(result);
                expect(stats.avgClarity).toBeNull();
                expect(stats.averageWPM).toBeNull();
                expect(stats.avgFillerWordsPerMin).toBeNull();
                // Duration is NOT evidence-gated — the RPC has always returned it honestly.
                expect(stats.totalPracticeTimeSeconds).toBe(200 * 60);
            });

            it('reports pace and filler rate as unknown when no session carries words and time', async () => {
                const result = await renderWithRpc(
                    rpcSummary({
                        avgWpm: null,
                        avgFillerWordsPerMin: null,
                        wpmContributorCount: 0,
                        fillerRateContributorCount: 0,
                    }),
                );
                expect(statsOf(result).averageWPM).toBeNull();
                expect(statsOf(result).avgFillerWordsPerMin).toBeNull();
                // Clarity is gated independently and still passes through.
                expect(Number(statsOf(result).avgClarity)).toBeCloseTo(81.5, 5);
            });

            it('preserves a genuine zero filler rate — real evidence of clean delivery', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgFillerWordsPerMin: '0.0', fillerRateContributorCount: 38 }),
                );
                expect(Number(statsOf(result).avgFillerWordsPerMin)).toBe(0);
                expect(statsOf(result).avgFillerWordsPerMin).not.toBeNull();
            });
        });
    });


    /**
     * #1472 (Sam 1792882179): the overview's ALL-TIME aggregate and this week's counts are `complete` only when they really
     * cover all history / the whole week. A failed or pending count, a short page or a failed summary never becomes a total.
     */
    describe('#1472 all-time and weekly availability', () => {
        const day = 24 * 60 * 60 * 1000;
        const row = (id: string, ageMs: number, duration = 60) =>
            ({ id, created_at: new Date(Date.now() - ageMs).toISOString(), duration, total_words: 100, filler_counts: { um: 1 }, engine: 'Private' });
        const history = (rows: unknown[], over: Record<string, unknown> = {}) =>
            (usePracticeHistory as Mock).mockReturnValue({ data: rows, isLoading: false, error: null, ...over });
        const summary = {
            overallStats: { totalSessions: 21, totalPracticeTime: 30, avgWpm: 120, clarityContributorCount: 0, wpmContributorCount: 21, fillerRateContributorCount: 0 },
            fillerWordTrends: {}, topFillerWords: [], weeklySessionsCount: 3, weeklyActivity: [{ day: 'Mon', sessions: 3 }],
        };
        // Sam's fixture: 21 sessions = newest 20 × 60 s plus the oldest 600 s → all-time is 21 sessions / 30 min, never 20 / 20.
        const newest20 = Array.from({ length: 20 }, (_, i) => row(`n${i}`, i * 60 * 60 * 1000));

        it('count pending → loading (never a default 0 that makes the page "complete")', async () => {
            history([row('a', 0)]);
            (getSessionCount as Mock).mockReturnValue(new Promise(() => {}));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            expect(result.current.allTime).toEqual({ status: 'loading' });
            expect(result.current.weekly).toEqual({ status: 'loading' });
        });

        it('count error → unavailable, even with a short loaded history', async () => {
            history([row('a', 0)]);
            (getSessionCount as Mock).mockRejectedValue(new Error('count failed'));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime).toEqual({ status: 'unavailable', reason: 'session_count_unavailable' }));
        });

        it('≤ 20 with settled length ≠ count (positive count, empty page) → unavailable, not perpetual loading', async () => {
            history([]);
            (getSessionCount as Mock).mockResolvedValue(3);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime).toEqual({ status: 'unavailable', reason: 'history_incomplete' }));
        });

        it('≤ 20 with a history error → unavailable', async () => {
            history([], { error: new Error('history failed') });
            (getSessionCount as Mock).mockResolvedValue(2);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime).toEqual({ status: 'unavailable', reason: 'history_failed' }));
        });

        it('successful 0 / empty history is complete', async () => {
            history([]);
            (getSessionCount as Mock).mockResolvedValue(0);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('complete'));
            expect(statsOf(result).totalSessions).toBe(0);
        });

        it('> 20 with a summary error and no cache → unavailable; the newest 20 never become 20 sessions / 20 min', async () => {
            history([...newest20]);
            (getSessionCount as Mock).mockResolvedValue(21);
            (getAnalyticsSummary as Mock).mockRejectedValue(new Error('rpc failed'));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime).toEqual({ status: 'unavailable', reason: 'summary_failed' }));
            // All 20 rows are inside this week's windows and the page's oldest row does not reach past them.
            expect(result.current.weekly).toEqual({ status: 'unavailable' });
        });

        it('> 20 summary loading → loading', async () => {
            history([...newest20]);
            (getSessionCount as Mock).mockResolvedValue(21);
            (getAnalyticsSummary as Mock).mockReturnValue(new Promise(() => {}));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(getAnalyticsSummary).toHaveBeenCalled());
            expect(result.current.allTime).toEqual({ status: 'loading' });
        });

        it('> 20 recovery: an error, then a successful refetch → complete with the summary values', async () => {
            history([...newest20]);
            (getSessionCount as Mock).mockResolvedValue(21);
            (getAnalyticsSummary as Mock).mockRejectedValueOnce(new Error('rpc failed')).mockResolvedValue(summary);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('unavailable'));
            await queryClient.refetchQueries({ queryKey: ['analyticsSummary'] });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('complete'));
            expect(statsOf(result).totalSessions).toBe(21);
            expect(result.current.weekly).toEqual({ status: 'complete', count: 3, activity: [{ day: 'Mon', sessions: 3 }] });
        });

        it('> 20 stale cached summary plus a refetch error → unavailable (summary_refetch_failed)', async () => {
            history([...newest20]);
            (getSessionCount as Mock).mockResolvedValue(21);
            (getAnalyticsSummary as Mock).mockResolvedValueOnce(summary).mockRejectedValue(new Error('refetch failed'));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('complete'));
            await queryClient.refetchQueries({ queryKey: ['analyticsSummary'] }).catch(() => undefined);
            await vi.waitFor(() => expect(result.current.allTime).toEqual({ status: 'unavailable', reason: 'summary_refetch_failed' }));
        });

        it('> 20 a history error does not invalidate a valid summary', async () => {
            history([], { error: new Error('history failed') });
            (getSessionCount as Mock).mockResolvedValue(21);
            (getAnalyticsSummary as Mock).mockResolvedValue(summary);
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('complete'));
            expect(result.current.error).toBeTruthy();
        });

        it('weekly from a partial page: complete only when the oldest row is before BOTH boundaries', async () => {
            const covering = [row('w1', 0), row('w2', 1 * day), ...Array.from({ length: 18 }, (_, i) => row(`o${i}`, (9 + i) * day))];
            history(covering);
            (getSessionCount as Mock).mockResolvedValue(30);
            (getAnalyticsSummary as Mock).mockRejectedValue(new Error('rpc failed'));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('unavailable'));
            expect(result.current.weekly).toMatchObject({ status: 'complete', count: 2 });
        });

        it('weekly: an invalid oldest timestamp proves nothing', async () => {
            history([row('w1', 0), { ...row('bad', 30 * day), created_at: 'not-a-date' }]);
            (getSessionCount as Mock).mockResolvedValue(30);
            (getAnalyticsSummary as Mock).mockRejectedValue(new Error('rpc failed'));
            const { result } = renderHook(() => useAnalytics(), { wrapper });
            await vi.waitFor(() => expect(result.current.allTime.status).toBe('unavailable'));
            expect(result.current.weekly).toEqual({ status: 'unavailable' });
        });
    });
});
