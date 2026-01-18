import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { usePracticeHistory } from './usePracticeHistory';
import {
    calculateOverallStats,
    calculateFillerWordTrends,
    calculateTopFillerWords,
    calculateAccuracyData
} from '../lib/analyticsUtils';

// DEV BYPASS: Mock session data for UI testing (defined outside hook to prevent re-creation)
const MOCK_SESSIONS = [
    {
        id: 'mock-session-1',
        user_id: 'dev-bypass-user-id',
        title: 'Monday Practice Session',
        transcript: 'This is a mock transcript for testing purposes.',
        duration: 720, // 12 minutes
        total_words: 1740, // ~145 WPM
        accuracy: 0.87,
        filler_words: { 'um': { count: 23 }, 'uh': { count: 18 }, 'like': { count: 15 }, 'you know': { count: 10 } } as { [key: string]: { count: number } },
        created_at: '2025-01-14T10:00:00.000Z', // Fixed date to prevent re-render
    },
    {
        id: 'mock-session-2',
        user_id: 'dev-bypass-user-id',
        title: 'Tuesday Practice Session',
        transcript: 'Another mock transcript.',
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
];

// Empty fallback array (defined outside hook to prevent re-creation)
const EMPTY_SESSIONS: typeof MOCK_SESSIONS = [];

export const useAnalytics = () => {
    const { sessionId } = useParams<{ sessionId: string }>();

    // 3.2 SCALABILITY FIX: Limit fetch to 20 sessions for dashboard/trends.
    // This prevents performance bottlenecks for users with many sessions.
    // In a future update, this could be expanded to full pagination.
    // CRITICAL: Memoize options to prevent new queryKey on every render
    const paginationOptions = useMemo(() => ({
        limit: sessionId ? 50 : 20
    }), [sessionId]);

    const { data, isLoading, error } = usePracticeHistory(paginationOptions);
    const allSessions = data ?? EMPTY_SESSIONS;

    // DEV BYPASS: Add mock session data for UI testing
    const isDevBypass = import.meta.env.DEV && window.location.search.includes('devBypass=true');

    // Use stable reference: allSessions from react-query is stable, MOCK_SESSIONS is a constant
    const sessionsToUse = isDevBypass ? MOCK_SESSIONS : allSessions;

    console.log('[useAnalytics] Hook called. SessionId:', sessionId, 'IsLoading:', isLoading, 'Sessions found:', sessionsToUse?.length, 'DevBypass:', isDevBypass);
    console.log('[useAnalytics] Raw sessions data:', sessionsToUse);

    const sessionHistory = useMemo(() => {
        if (sessionId) {
            console.log('[useAnalytics] Filtering for specific sessionId:', sessionId);
            return sessionsToUse.filter(s => s.id === sessionId);
        }
        console.log('[useAnalytics] Returning all sessions:', sessionsToUse.length);
        return sessionsToUse;
    }, [sessionId, sessionsToUse]);

    const analyticsData = useMemo(() => {
        console.log('[useAnalytics] Computing analytics data. SessionHistory length:', sessionHistory?.length);
        if (!sessionHistory || sessionHistory.length === 0) {
            console.log('[useAnalytics] No sessions - returning empty analytics data');
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

        console.log('[useAnalytics] Computing stats for', sessionHistory.length, 'sessions');
        return {
            overallStats: calculateOverallStats(sessionHistory),
            fillerWordTrends: calculateFillerWordTrends(sessionHistory.slice(0, 5)),
            topFillerWords: calculateTopFillerWords(sessionHistory),
            accuracyData: calculateAccuracyData(sessionHistory)
        };
    }, [sessionHistory]);

    return {
        sessionHistory,
        ...analyticsData,
        // DEV BYPASS: Force loading to false when devBypass is active so UI renders with mock data
        loading: isDevBypass ? false : isLoading,
        error
    };
};