import { useMemo, useEffect } from 'react';
import logger from '../lib/logger';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { usePracticeHistory } from './usePracticeHistory';
import { useSession } from './useSession';
import { getAnalyticsSummary, getFirstSessionCreatedAt, getSessionCount } from '../lib/storage';
import {
    calculateOverallStats,
    calculateFillerWordTrends,
    calculateTopFillerWords,
} from '../lib/analyticsUtils';
import type { PracticeSession } from '../types/session';
import type { AllTimeAggregate, AnalyticsSummary, OverallStats, WeeklyActivityDay, WeeklyAggregate } from '../types/analytics';
import { DASHBOARD_PAGINATION_LIMIT } from '../config/env';
import { useReadinessStore } from '../stores/useReadinessStore';

/**
 * #1045 finding 3: derive the canonical duration fields from what `get_analytics_summary` actually
 * returns (`totalPracticeTime` in rounded minutes + `totalSessions`).
 *
 * Precision caveat, handled honestly: the RPC rounds to whole minutes, so a total under 30 seconds
 * arrives as 0. Reporting that as "0 mins" would repeat the very defect this PR fixes, and inventing
 * a sub-minute number would be false precision. In that one case the duration is reported as unknown
 * — we know practice happened, but not to a precision this path can express.
 */
const adaptRpcDurations = (rpc: Record<string, unknown>): {
totalPracticeTimeSeconds: number;
averageSessionLength: number | null;
averageSessionLengthSeconds: number | null;
} => {
const minutes = firstFiniteOrNull(rpc.totalPracticeTime);
const sessions = firstFiniteOrNull(rpc.totalSessions);
if (minutes === null || minutes <= 0 || sessions === null || sessions <= 0) {
    return { totalPracticeTimeSeconds: 0, averageSessionLength: null, averageSessionLengthSeconds: null };
}
const totalSeconds = minutes * 60;
return {
    totalPracticeTimeSeconds: totalSeconds,
    averageSessionLength: minutes / sessions,
    averageSessionLengthSeconds: totalSeconds / sessions,
};
};

/**
 * #1045 / #1091: read an RPC aggregate ONLY when the RPC also told us how many sessions actually
 * contributed evidence to it.
 *
 * Two distinct failure modes are collapsed into one honest answer here:
 *
 *  1. Zero contributors. `get_analytics_summary` (v4) reports the aggregate as JSON null in this case,
 *     but the count is what makes the distinction explicit: "the average is genuinely low" vs "there is
 *     no evidence". With no contributors the metric is unknown, not zero.
 *
 *  2. A database on which the v4 migration has NOT been applied. Then the contributor key is simply
 *     absent, and the legacy value on the wire is the CONTAMINATED one — v3 averaged clarity (and pace,
 *     and filler rate) over every session while folding each missing measurement in as a hard zero.
 *     That is precisely the "Clear Delivery 0%" defect. A client guard cannot repair it: the server has
 *     already summed and divided by the wrong denominator, and a collapsed average cannot be
 *     un-collapsed downstream. So we degrade to unknown — the dashboard renders "Not enough data" —
 *     rather than render a number we know to be wrong.
 *
 * This is deliberately fail-closed: until the migration is applied, these cards say "Not enough data".
 */
const rpcAggregateWithEvidence = (
    contributorCount: unknown,
    ...valueCandidates: unknown[]
): number | null => {
    const contributors = firstFiniteOrNull(contributorCount);
    if (contributors === null || contributors <= 0) return null;
    return firstFiniteOrNull(...valueCandidates);
};

/** #1045: first argument that is a real finite number, else null (never a fabricated 0). */
const firstFiniteOrNull = (...candidates: unknown[]): number | null => {
for (const c of candidates) {
    const n = typeof c === 'number' ? c : Number(c);
    if (c !== null && c !== undefined && c !== '' && Number.isFinite(n)) return n;
}
return null;
};

// Empty fallback array (defined outside hook to prevent re-creation)
const EMPTY_SESSIONS: PracticeSession[] = [];

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The client's this-week counts, in the browser's local time (unchanged definition). `now` is captured ONCE by the
 * caller so the counts and the coverage check below use the same clock. No parity with the database week is claimed.
 */
const clientWeekly = (sessions: PracticeSession[], now: Date) => {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const weeklySessionsCount = sessions.filter(s => new Date(s.created_at) >= sevenDaysAgo).length;
    const dayCounts: Record<string, number> = {};
    WEEK_DAYS.forEach(d => { dayCounts[d] = 0; });
    sessions.forEach(s => {
        const d = new Date(s.created_at);
        if (d >= startOfWeek) dayCounts[WEEK_DAYS[d.getDay()]]++;
    });
    const weeklyActivity: WeeklyActivityDay[] = WEEK_DAYS.map(day => ({ day, sessions: dayCounts[day] }));
    return { weeklySessionsCount, weeklyActivity, sevenDaysAgo, startOfWeek };
};

/**
 * #1472: a newest-first PARTIAL page proves this week's counts only when its oldest row has a valid timestamp strictly
 * before BOTH window boundaries — then every session inside the windows is on the page. Empty or invalid proves nothing.
 */
const pageCoversWeek = (sessions: PracticeSession[], sevenDaysAgo: Date, startOfWeek: Date): boolean => {
    const oldest = sessions.length > 0 ? new Date(sessions[sessions.length - 1].created_at) : null;
    if (!oldest || !Number.isFinite(oldest.getTime())) return false;
    return oldest < sevenDaysAgo && oldest < startOfWeek;
};

const isFiniteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * #1472: a summary is complete only with its REQUIRED totals present as real numbers. `{}` or nulls are not a summary.
 * The averages stay legitimately nullable (no contributing evidence), so they are not required here.
 */
const isValidSummary = (s: AnalyticsSummary | null | undefined): s is AnalyticsSummary => {
    if (!s || typeof s !== 'object' || !s.overallStats || typeof s.overallStats !== 'object') return false;
    const o = s.overallStats as unknown as Record<string, unknown>;
    return isFiniteNonNegative(o.totalSessions) && isFiniteNonNegative(o.totalPracticeTime);
};

/** #1472: the RPC's week only as a real count plus seven well-formed day rows — never `Number(null)` as 0. */
const isValidRpcWeekly = (s: AnalyticsSummary): boolean =>
    isFiniteNonNegative(s.weeklySessionsCount)
    && Array.isArray(s.weeklyActivity)
    && s.weeklyActivity.length === WEEK_DAYS.length
    && s.weeklyActivity.every((d) => !!d && WEEK_DAYS.includes(d.day) && isFiniteNonNegative(d.sessions))
    // Exactly one row per day: seven "Mon" rows would pass the checks above while the chart reads the first and Trends sums all.
    && new Set(s.weeklyActivity.map((d) => d.day)).size === WEEK_DAYS.length;

export const useAnalytics = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { user } = useAuthProvider();

    // 3.2 SCALABILITY FIX: This prevents performance bottlenecks for users with many sessions.
    const paginationOptions = useMemo(() => ({
        limit: DASHBOARD_PAGINATION_LIMIT,
    }), []);

    const { data: allSessions = EMPTY_SESSIONS, isLoading, error } = usePracticeHistory(paginationOptions);
    const { data: specificSession, isLoading: isSessionLoading } = useSession(sessionId);

    // Signal Analytics Readiness (Critical Query Settlement)
    useEffect(() => {
        // Resolve readiness if loading completes OR if an error is encountered.
        // This ensures the E2E runner isn't trapped in a skeleton hang.
        if (!isLoading || !!error) {
            useReadinessStore.getState().setReady('analytics');
            logger.info({ isLoading, hasError: !!error }, '[useAnalytics] ✅ Analytics Ready Signal');
        }
    }, [isLoading, error]);

    const sessionCountQuery = useQuery({
        queryKey: ["sessionCount", user?.id],
        queryFn: () => getSessionCount(user!.id),
        enabled: !!user && !sessionId,
    });
    // #1258 D5: the oldest counted session's date for the Progress header ("since {date}"). History is paged, so the
    // oldest row is read directly rather than taken from a page.
    const { data: firstSessionAt = null } = useQuery({
        queryKey: ["firstSessionAt", user?.id],
        queryFn: () => getFirstSessionCreatedAt(user!.id),
        enabled: !!user && !sessionId,
    });

    // #1472: a pending or failed count is NOT zero. It no longer defaults the history into a "complete" client total.
    const totalSessionsCount = sessionCountQuery.isSuccess ? sessionCountQuery.data : null;

    // Use RPC for aggregation when dataset is large (> 20 sessions)
    // and we are not in a specific session view.
    const shouldUseRPC = totalSessionsCount !== null && totalSessionsCount > 20 && !sessionId;

    const summaryQuery = useQuery({
        queryKey: ["analyticsSummary", user?.id],
        queryFn: () => getAnalyticsSummary(user!.id),
        enabled: !!user && shouldUseRPC,
        staleTime: 5 * 60 * 1000,
    });
    const summaryData = summaryQuery.data;
    const isSummaryLoading = summaryQuery.isLoading;

    const sessionsToUse = allSessions;

    logger.debug({ sessionId, isLoading, sessions: sessionsToUse?.length }, '[useAnalytics] Hook called');

    const sessionHistory = useMemo(() => {
        if (sessionId) {
            logger.debug({ sessionId }, '[useAnalytics] Filtering for specific session');
            // If we have a specific session fetch result, use that. 
            // Otherwise try to find it in the current list.
            if (specificSession) {
                return [specificSession];
            }
            return sessionsToUse.filter(s => s.id === sessionId);
        }
        logger.debug({ count: sessionsToUse.length }, '[useAnalytics] Returning all sessions');
        return sessionsToUse;
    }, [sessionId, sessionsToUse, specificSession]);

    const analyticsData = useMemo(() => {
        // Use pre-computed summary from RPC if available and appropriate
        // #1472: validated BEFORE adaptation — a truthy summary without real totals would otherwise be dereferenced here.
        if (shouldUseRPC && isValidSummary(summaryData)) {
            logger.debug('[useAnalytics] Using summary data from RPC');
            const rpcOverallStats = summaryData.overallStats as unknown as Record<string, unknown>;
            return {
                ...summaryData,
                overallStats: {
                    ...summaryData.overallStats,
                    // #1045 finding 3: `get_analytics_summary` never returned `averageSessionLength`
                    // or any seconds field — the old `|| 0` therefore reported a confident "0 mins"
                    // for every history large enough to use the RPC path, and naively switching that
                    // to null would have thrown away duration the RPC DOES return. Adapt the real
                    // contract instead of migrating it: the RPC gives `totalPracticeTime` in ROUNDED
                    // MINUTES and `totalSessions`, which is enough to derive both fields.
                    ...adaptRpcDurations(rpcOverallStats),
                    averageWPM: rpcAggregateWithEvidence(
                        rpcOverallStats.wpmContributorCount,
                        rpcOverallStats.avgWpm,
                    ),
                    // The RPC's legacy `avgAccuracy` key holds clarity, not STT accuracy — v4 adds an
                    // explicit `avgClarity` and keeps `avgAccuracy` as a compatibility alias, so read
                    // the explicit key first. Both are gated on `clarityContributorCount` because v3
                    // averaged clarity over ALL sessions, scoring every phase-2c metrics-write failure
                    // as a zero. Users past the >20-session RPC threshold — the ones who saw
                    // "Clear Delivery 0%" — are served entirely by this branch.
                    avgClarity: rpcAggregateWithEvidence(
                        rpcOverallStats.clarityContributorCount,
                        rpcOverallStats.avgClarity,
                        rpcOverallStats.avgAccuracy,
                    ),
                    avgFillerWordsPerMin: rpcAggregateWithEvidence(
                        rpcOverallStats.fillerRateContributorCount,
                        rpcOverallStats.avgFillerWordsPerMin,
                    ),
                    // The RPC does not compute pause rhythm at all — genuinely unknown on this path.
                    avgPausesPerMin: firstFiniteOrNull(rpcOverallStats.avgPausesPerMin),
                }
            };
        }

        logger.debug({ count: sessionHistory?.length }, '[useAnalytics] Computing analytics data');
        if (!sessionHistory || sessionHistory.length === 0) {
            logger.debug('[useAnalytics] No sessions - returning empty analytics data');
            return {
                overallStats: {
                    // #1045: a user with no sessions has produced no evidence. Zeros here rendered as
                    // "0%" / "0.0/min" / "0 mins" — confident statements about speaking that never happened.
                    totalSessions: 0,
                    totalPracticeTime: 0,
                    totalPracticeTimeSeconds: 0,
                    averageSessionLength: null,
                    averageSessionLengthSeconds: null,
                    averageWPM: null,
                    avgFillerWordsPerMin: null,
                    avgClarity: null,
                    avgPausesPerMin: null,
                    chartData: []
                },
                fillerWordTrends: {},
                topFillerWords: [],
                weeklySessionsCount: 0,
                weeklyActivity: []
            };
        }

        logger.debug({ count: sessionHistory.length }, '[useAnalytics] Computing stats');
        const overallStats = calculateOverallStats(sessionHistory);
        const fillerWordTrends = calculateFillerWordTrends(sessionHistory);
        const topFillerWords = calculateTopFillerWords(sessionHistory);

        // #1472: this week's counts are derived in the availability memo below, on the current wall clock.
        const { weeklySessionsCount, weeklyActivity } = clientWeekly(sessionHistory, new Date());

        return {
            overallStats,
            fillerWordTrends,
            topFillerWords,
            weeklySessionsCount,
            weeklyActivity
        };
    }, [shouldUseRPC, summaryData, sessionHistory]);

    /**
     * #1472: what the overview may call ALL-TIME, and this week's counts. Exact states (Sam 1792882179):
     *  - count pending → loading; count error → unavailable.
     *  - count ≤ 20: history pending → loading; history error → unavailable; settled length ≠ count (incl. a positive count
     *    with an empty page) → unavailable; settled length === count (incl. 0) → complete from that full history.
     *  - count > 20: only a valid, successful summary with no error is complete; a summary error (with or without cached
     *    data) or a settled missing/invalid summary is unavailable. A history error does not invalidate a valid summary.
     */
    const { allTime, weekly } = useMemo((): { allTime: AllTimeAggregate; weekly: WeeklyAggregate } => {
        if (!sessionCountQuery.isSuccess) {
            return sessionCountQuery.isError
                ? { allTime: { status: 'unavailable', reason: 'session_count_unavailable' }, weekly: { status: 'unavailable' } }
                : { allTime: { status: 'loading' }, weekly: { status: 'loading' } };
        }
        const count = sessionCountQuery.data;
        // #1472: the CURRENT wall clock, read once here so this week's counts and the page-coverage check agree. Never the
        // history's fetch time: a cached Saturday page reopened on Sunday must be judged against Sunday's week. Limit: the
        // clock is read when this memo recomputes (mount or new data); a view left mounted across midnight does not roll over
        // until then. No timer is added here (Sam 1792885199).
        const now = new Date();
        const historyPending = isLoading && !error;
        const page = allSessions;
        const partialWeekly = (): WeeklyAggregate => {
            if (historyPending) return { status: 'loading' };
            if (error) return { status: 'unavailable' };
            const w = clientWeekly(page, now);
            return pageCoversWeek(page, w.sevenDaysAgo, w.startOfWeek)
                ? { status: 'complete', count: w.weeklySessionsCount, activity: w.weeklyActivity }
                : { status: 'unavailable' };
        };
        if (count <= 20) {
            if (historyPending) return { allTime: { status: 'loading' }, weekly: { status: 'loading' } };
            if (error) return { allTime: { status: 'unavailable', reason: 'history_failed' }, weekly: { status: 'unavailable' } };
            if (page.length !== count) return { allTime: { status: 'unavailable', reason: 'history_incomplete' }, weekly: partialWeekly() };
            const w = clientWeekly(page, now);
            return {
                allTime: { status: 'complete', stats: analyticsData.overallStats as OverallStats },
                weekly: { status: 'complete', count: w.weeklySessionsCount, activity: w.weeklyActivity },
            };
        }
        if (summaryQuery.isError) {
            return {
                allTime: { status: 'unavailable', reason: summaryQuery.data ? 'summary_refetch_failed' : 'summary_failed' },
                weekly: partialWeekly(),
            };
        }
        if (summaryQuery.isPending) return { allTime: { status: 'loading' }, weekly: { status: 'loading' } };
        if (!isValidSummary(summaryData)) return { allTime: { status: 'unavailable', reason: 'summary_failed' }, weekly: partialWeekly() };
        return {
            allTime: { status: 'complete', stats: analyticsData.overallStats as OverallStats },
            weekly: isValidRpcWeekly(summaryData)
                ? { status: 'complete', count: summaryData.weeklySessionsCount, activity: summaryData.weeklyActivity }
                : partialWeekly(),
        };
    }, [sessionCountQuery.isSuccess, sessionCountQuery.isError, sessionCountQuery.data, summaryQuery.isError,
        summaryQuery.isPending, summaryQuery.data, summaryData, isLoading, error, allSessions, analyticsData]);

    // CRITICAL: Don't wait for individual session query if the session list
    // has already loaded and the session isn't in it. This prevents the
    // "Session Not Found" UI from being blocked by a hanging session fetch
    // (e.g., in E2E mocks where individual session routes aren't intercepted).
    const sessionExistsInList = sessionId
        ? sessionsToUse.some(s => s.id === sessionId)
        : true;

    const effectiveSessionLoading = sessionId && (isLoading || sessionExistsInList)
        ? isSessionLoading
        : false;

    // #1472: the window-derived `overallStats` / weekly fields are NOT returned bare; consumers read `allTime` / `weekly`.
    return {
        sessionHistory,
        fillerWordTrends: analyticsData.fillerWordTrends,
        topFillerWords: analyticsData.topFillerWords,
        allTime,
        weekly,
        firstSessionAt,
        loading: (isLoading && !error) || (effectiveSessionLoading && !error) || (shouldUseRPC && isSummaryLoading),
        error
    };
};
