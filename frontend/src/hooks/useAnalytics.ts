import { useMemo, useEffect } from 'react';
import logger from '../lib/logger';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { usePracticeHistory } from './usePracticeHistory';
import { useSession } from './useSession';
import { getAnalyticsSummary, getSessionCount } from '../lib/storage';
import {
    calculateOverallStats,
    calculateFillerWordTrends,
    calculateTopFillerWords,
    calculateAccuracyData
} from '../lib/analyticsUtils';
import type { PracticeSession } from '../types/session';
import { DASHBOARD_PAGINATION_LIMIT } from '../config/env';
import { ANALYTICS_MOCK_SESSIONS as MOCK_SESSIONS } from '../lib/mockData';
import { useReadinessStore } from '../stores/useReadinessStore';

// Empty fallback array (defined outside hook to prevent re-creation)
const EMPTY_SESSIONS: PracticeSession[] = [];

export const useAnalytics = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { user } = useAuthProvider();

    // 3.2 SCALABILITY FIX: This prevents performance bottlenecks for users with many sessions.
    const paginationOptions = useMemo(() => ({
        limit: DASHBOARD_PAGINATION_LIMIT
    }), []);

    const { data: allSessions = EMPTY_SESSIONS, isLoading, error } = usePracticeHistory(paginationOptions);
    const { data: specificSession, isLoading: isSessionLoading } = useSession(sessionId);

    // 🚀 PHASE 8: Signal Analytics Readiness (Critical Query Settlement)
    useEffect(() => {
        if (!isLoading) {
            useReadinessStore.getState().setReady('analytics');
            logger.info('[useAnalytics] ✅ Analytics Ready Signal');
        }
    }, [isLoading]);

    const { data: totalSessionsCount = 0 } = useQuery({
        queryKey: ["sessionCount", user?.id],
        queryFn: () => getSessionCount(user!.id),
        enabled: !!user && !sessionId,
    });

    // Use RPC for aggregation when dataset is large (> 20 sessions)
    // and we are not in a specific session view.
    const shouldUseRPC = totalSessionsCount > 20 && !sessionId;

    const { data: summaryData, isLoading: isSummaryLoading } = useQuery({
        queryKey: ["analyticsSummary", user?.id],
        queryFn: () => getAnalyticsSummary(user!.id),
        enabled: !!user && shouldUseRPC,
        staleTime: 5 * 60 * 1000,
    });

    // DEV BYPASS: Add mock session data for UI testing
    const isDevBypass = import.meta.env.DEV && window.location.search.includes('devBypass=true');

    // Use stable reference: allSessions from react-query is stable, MOCK_SESSIONS is a constant
    const sessionsToUse = isDevBypass ? MOCK_SESSIONS : allSessions;

    logger.debug({ sessionId, isLoading, sessions: sessionsToUse?.length, isDevBypass }, '[useAnalytics] Hook called');

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
        if (shouldUseRPC && summaryData) {
            logger.debug('[useAnalytics] Using summary data from RPC');
            return {
                ...summaryData,
                overallStats: {
                    ...summaryData.overallStats,
                    averageWPM: (summaryData.overallStats as unknown as Record<string, unknown>).avgWpm as number || 0
                }
            };
        }

        logger.debug({ count: sessionHistory?.length }, '[useAnalytics] Computing analytics data');
        if (!sessionHistory || sessionHistory.length === 0) {
            logger.debug('[useAnalytics] No sessions - returning empty analytics data');
            return {
                overallStats: {
                    totalSessions: 0,
                    totalPracticeTime: 0,
                    averageWPM: 0,
                    avgFillerWordsPerMin: "0.0",
                    avgAccuracy: "0.0",
                    chartData: []
                },
                fillerWordTrends: {},
                topFillerWords: [],
                accuracyData: [],
                weeklySessionsCount: 0,
                weeklyActivity: []
            };
        }

        logger.debug({ count: sessionHistory.length }, '[useAnalytics] Computing stats');
        const overallStats = calculateOverallStats(sessionHistory);
        const fillerWordTrends = calculateFillerWordTrends(sessionHistory);
        const topFillerWords = calculateTopFillerWords(sessionHistory);
        const accuracyData = calculateAccuracyData(sessionHistory);

        // Client-side fallback for weekly metrics
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weeklySessionsCount = sessionHistory.filter(s => new Date(s.created_at) >= sevenDaysAgo).length;

        const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const dayCounts: Record<string, number> = {};
        DAYS.forEach(d => { dayCounts[d] = 0; });
        sessionHistory.forEach(s => {
            const d = new Date(s.created_at);
            if (d >= startOfWeek) dayCounts[DAYS[d.getDay()]]++;
        });
        const weeklyActivity = DAYS.map(day => ({ day, sessions: dayCounts[day] }));

        return {
            overallStats,
            fillerWordTrends,
            topFillerWords,
            accuracyData,
            weeklySessionsCount,
            weeklyActivity
        };
    }, [shouldUseRPC, summaryData, sessionHistory]);

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

    return {
        sessionHistory,
        ...analyticsData,
        // DEV BYPASS: Force loading to false when devBypass is active so UI renders with mock data
        loading: isDevBypass ? false : (isLoading || effectiveSessionLoading || (shouldUseRPC && isSummaryLoading)),
        error
    };
};