import type { PracticeSession } from '@/types/session';

export const calculateOverallStats = (sessionHistory: PracticeSession[]) => {
    const totalSessions = sessionHistory.length;
    const totalPracticeTime = Math.round(sessionHistory.reduce((sum, s) => sum + (s.duration || 0), 0) / 60);
    const totalWords = sessionHistory.reduce((sum, s) => sum + (s.total_words || 0), 0);
    const avgWpm = totalPracticeTime > 0 ? Math.round(totalWords / (totalPracticeTime)) : 0;
    const totalFillerWords = sessionHistory.reduce((sum, s) => sum + (s.filler_words?.total?.count || 0), 0);
    const avgFillerWordsPerMin = totalPracticeTime > 0 ? (totalFillerWords / totalPracticeTime).toFixed(1) : "0.0";
    const avgAccuracy = totalSessions > 0 ? (sessionHistory.reduce((sum, s) => sum + (s.accuracy || 0), 0) / totalSessions * 100).toFixed(1) : "0.0";
    const chartData = sessionHistory.map(s => ({
        date: new Date(s.created_at).toLocaleDateString(),
        'FW/min': s.duration > 0 ? ((s.filler_words?.total?.count || 0) / (s.duration / 60)).toFixed(2) : "0.0"
    })).reverse();

    return { totalSessions, totalPracticeTime, avgWpm, avgFillerWordsPerMin, avgAccuracy, chartData };
};

export const calculateFillerWordTrends = (sessionHistory: PracticeSession[]) => {
    const trendData: { [key: string]: { current: number; previous: number } } = {};
    if (sessionHistory.length > 0) {
        const currentSession = sessionHistory[0];
        const previousSession = sessionHistory[1];

        const allKeys = new Set([
            ...Object.keys(currentSession.filler_words || {}),
            ...(previousSession ? Object.keys(previousSession.filler_words || {}) : [])
        ]);

        allKeys.forEach(key => {
            if (key !== 'total') {
                const currentCount = currentSession.filler_words?.[key]?.count || 0;
                const previousCount = previousSession?.filler_words?.[key]?.count || 0;
                trendData[key] = { current: currentCount, previous: previousCount };
            }
        });
    }
    return trendData;
};