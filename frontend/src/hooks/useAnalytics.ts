import { useMemo } from 'react';
import logger from '../lib/logger';
import { useParams } from 'react-router-dom';
import { usePracticeHistory } from './usePracticeHistory';
import { useSession } from './useSession';
import {
    calculateOverallStats,
    calculateFillerWordTrends,
    calculateTopFillerWords,
    calculateAccuracyData
} from '../lib/analyticsUtils';
import type { PracticeSession } from '../types/session';

// DEV BYPASS: Mock session data for UI testing (defined outside hook to prevent re-creation)
const MOCK_SESSIONS: PracticeSession[] = [
    {
        id: 'mock-session-1',
        user_id: 'dev-bypass-user-id',
        title: 'Monday Practice Session',
        duration: 720, // 12 minutes
        total_words: 1740, // ~145 WPM
        accuracy: 0.886,
        ground_truth: 'This is the ground truth transcript for testing.',
        transcript: 'This is a mock transcript for testing purposes.', // has some errors
        engine: 'cloud',
        filler_words: { 'um': { count: 23 }, 'uh': { count: 18 }, 'like': { count: 15 }, 'you know': { count: 10 } } as { [key: string]: { count: number } },
        created_at: '2025-01-14T10:00:00.000Z', // Fixed date to prevent re-render
    },
    {
        id: 'mock-session-2',
        user_id: 'dev-bypass-user-id',
        title: 'Tuesday Practice Session',
        ground_truth: 'Another ground truth transcript.',
        transcript: 'Another mock transcript.',
        engine: 'cloud',
        duration: 480,
        total_words: 1100,
        accuracy: 0.85,
        filler_words: { 'um': { count: 8 }, 'uh': { count: 5 } } as { [key: string]: { count: number } },
        created_at: '2025-01-13T10:00:00.000Z',
    },
    {
        id: 'mock-session-3',
        user_id: 'dev-bypass-user-id',
        title: 'Wednesday Practice Session',
        transcript: 'Mock transcript three.',
        duration: 600,
        total_words: 1500,
        accuracy: 0.82,
        filler_words: { 'um': { count: 12 } } as { [key: string]: { count: number } },
        created_at: '2025-01-12T10:00:00.000Z',
    },
] as unknown as PracticeSession[];

// Empty fallback array (defined outside hook to prevent re-creation)
const EMPTY_SESSIONS: PracticeSession[] = [];

export const useAnalytics = () => {
    const { sessionId } = useParams<{ sessionId: string }>();

    // 3.2 SCALABILITY FIX: Limit fetch to 20 sessions for dashboard/trends.
    // This prevents performance bottlenecks for users with many sessions.
    const paginationOptions = useMemo(() => ({
        limit: 20
    }), []);

    const { data, isLoading, error } = usePracticeHistory(paginationOptions);
    const { data: specificSession, isLoading: isSessionLoading } = useSession(sessionId);

    const allSessions = data ?? EMPTY_SESSIONS;

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
        logger.debug({ count: sessionHistory?.length }, '[useAnalytics] Computing analytics data');
        if (!sessionHistory || sessionHistory.length === 0) {
            logger.debug('[useAnalytics] No sessions - returning empty analytics data');
            return {
                overallStats: {
                    totalSessions: 0,
                    totalPracticeTime: 0,
                    avgWpm: 0,
                    avgFillerWordsPerMin: "0.0",
                    avgAccuracy: "0.0",
                    chartData: []
                },
                fillerWordTrends: {},
                topFillerWords: [],
                accuracyData: []
            };
        }

        logger.debug({ count: sessionHistory.length }, '[useAnalytics] Computing stats');
        return {
            overallStats: calculateOverallStats(sessionHistory),
            fillerWordTrends: calculateFillerWordTrends(sessionHistory.slice(0, 5)),
            topFillerWords: calculateTopFillerWords(sessionHistory),
            accuracyData: calculateAccuracyData(sessionHistory)
        };
    }, [sessionHistory]);

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
        loading: isDevBypass ? false : (isLoading || effectiveSessionLoading),
        error: isDevBypass ? null : error
    };
};