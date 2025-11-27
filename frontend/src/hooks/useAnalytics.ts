import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { usePracticeHistory } from './usePracticeHistory';
import {
    calculateOverallStats,
    calculateFillerWordTrends,
    calculateTopFillerWords,
    calculateAccuracyData
} from '../lib/analyticsUtils';

export const useAnalytics = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const { data: allSessions = [], isLoading, error } = usePracticeHistory();

    console.log('[useAnalytics] Hook called. SessionId:', sessionId, 'IsLoading:', isLoading, 'Sessions found:', allSessions?.length);

    const sessionHistory = useMemo(() => {
        if (sessionId) {
            return allSessions.filter(s => s.id === sessionId);
        }
        return allSessions;
    }, [sessionId, allSessions]);

    const analyticsData = useMemo(() => {
        if (!sessionHistory || sessionHistory.length === 0) {
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
        loading: isLoading,
        error
    };
};