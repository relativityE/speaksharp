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

        expect(result.current.overallStats.totalSessions).toBe(2);
        expect(result.current.overallStats.totalPracticeTime).toBe(3); // 180s / 60 = 3m
        expect(result.current.weeklySessionsCount).toBe(2);
        expect(result.current.weeklyActivity).toHaveLength(7);
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
        expect(result.current.overallStats.totalSessions).toBe(1);
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
            await vi.waitFor(() => expect(result.current.overallStats.totalSessions).toBe(40));
            return result;
        };

        it('derives duration in seconds from the minutes the RPC actually returns', async () => {
            const result = await renderWithRpc(rpcSummary());
            const stats = result.current.overallStats;
            expect(stats.totalPracticeTimeSeconds).toBe(200 * 60);
            expect(stats.averageSessionLengthSeconds).toBeCloseTo((200 * 60) / 40, 5);
            expect(stats.averageSessionLength).toBeCloseTo(200 / 40, 5);
        });

        it('maps the RPC clarity field instead of dropping Clear Delivery on this path', async () => {
            const result = await renderWithRpc(rpcSummary());
            expect(Number(result.current.overallStats.avgClarity)).toBeCloseTo(81.5, 5);
        });

        it('reports duration as unknown — never 0 mins — when the RPC returns no usable duration', async () => {
            const result = await renderWithRpc(rpcSummary({ totalPracticeTime: 0 }));
            const stats = result.current.overallStats;
            // Rounded minutes of 0 means the total is under 30s: real, but not expressible at this
            // precision. Unknown is honest; "0 mins" would repeat the defect this PR fixes.
            expect(stats.averageSessionLengthSeconds).toBeNull();
            expect(stats.averageSessionLength).toBeNull();
        });

        it('reports pause rhythm as unknown because the RPC does not compute it', async () => {
            const result = await renderWithRpc(rpcSummary());
            expect(result.current.overallStats.avgPausesPerMin).toBeNull();
        });

        /**
         * #1091 blocker: users past the >20-session threshold never touch `calculateOverallStats`, so
         * the client-side clarity fix does not reach them. The server aggregate is fixed in migration
         * 20260729130000; these tests pin the CONTRACT the hook must hold up at that boundary.
         */
        describe('#1091 RPC evidence-validity contract', () => {
            it('passes the real clarity average through when contributors exist', async () => {
                const result = await renderWithRpc(rpcSummary());
                expect(Number(result.current.overallStats.avgClarity)).toBeCloseTo(81.5, 5);
                expect(result.current.overallStats.averageWPM).toBe(145);
                expect(Number(result.current.overallStats.avgFillerWordsPerMin)).toBeCloseTo(2.4, 5);
            });

            it('prefers the explicit avgClarity key over the legacy avgAccuracy alias', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: '74.2', avgAccuracy: '81.5' }),
                );
                expect(Number(result.current.overallStats.avgClarity)).toBeCloseTo(74.2, 5);
            });

            it('still reads clarity from avgAccuracy when only the alias is populated', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: null, avgAccuracy: '77.0' }),
                );
                expect(Number(result.current.overallStats.avgClarity)).toBeCloseTo(77, 5);
            });

            it('reports clarity as unknown — not 0.0 — when zero sessions carry clarity evidence', async () => {
                // Every session lost its phase-2c metrics write: clarity_score is NULL everywhere.
                // The v4 RPC reports null + a zero contributor count; anything numeric here would be
                // the "Clear Delivery 0%" defect reappearing on the path that actually serves the user.
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: null, avgAccuracy: null, clarityContributorCount: 0 }),
                );
                expect(result.current.overallStats.avgClarity).toBeNull();
                expect(result.current.overallStats.avgClarity).not.toBe('0.0');
                expect(result.current.overallStats.avgClarity).not.toBe(0);
            });

            it('never resurrects a number from a stale value when the contributor count is 0', async () => {
                // Defensive: even if a server somehow returns both a zero count AND a number, the count
                // is the evidence of record. No contributors means no average.
                const result = await renderWithRpc(
                    rpcSummary({ avgClarity: '0.0', avgAccuracy: '0.0', clarityContributorCount: 0 }),
                );
                expect(result.current.overallStats.avgClarity).toBeNull();
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
                const stats = result.current.overallStats;
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
                expect(result.current.overallStats.averageWPM).toBeNull();
                expect(result.current.overallStats.avgFillerWordsPerMin).toBeNull();
                // Clarity is gated independently and still passes through.
                expect(Number(result.current.overallStats.avgClarity)).toBeCloseTo(81.5, 5);
            });

            it('preserves a genuine zero filler rate — real evidence of clean delivery', async () => {
                const result = await renderWithRpc(
                    rpcSummary({ avgFillerWordsPerMin: '0.0', fillerRateContributorCount: 38 }),
                );
                expect(Number(result.current.overallStats.avgFillerWordsPerMin)).toBe(0);
                expect(result.current.overallStats.avgFillerWordsPerMin).not.toBeNull();
            });
        });
    });

});
