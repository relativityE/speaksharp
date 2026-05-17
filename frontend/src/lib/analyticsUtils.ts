import type { PracticeSession } from '@/types/session';
import { calculateWordErrorRate } from './wer';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';

/**
 * P1 TECH DEBT: Client-side Aggregation
 * 
 * Current implementation: All aggregation happens in browser
 * - Acceptable for alpha with <100 sessions per user
 * - Monitor performance with console.time() in development
 * 
 * Future optimization (when users have 500+ sessions):
 * - Create Supabase RPC: `get_analytics_summary(user_id, date_range)`
 * - Pre-compute daily/weekly summaries in DB
 * - Only fetch aggregated results, not raw sessions
 * 
 * Migration path:
 * 1. Add RPC function to Supabase
 * 2. Update usePracticeHistory to use RPC when session count > threshold
 * 3. Keep client-side as fallback for small datasets
 */

export const calculateOverallStats = (sessionHistory: PracticeSession[]) => {
    // P1 FIX: Early exit for empty data
    if (!sessionHistory || sessionHistory.length === 0) {
        return {
            totalSessions: 0,
            totalPracticeTime: 0,
            averageWPM: 0,
            avgFillerWordsPerMin: "0.0",
            avgAccuracy: "0.0",
            chartData: []
        };
    }

    const totalSessions = sessionHistory.length;

    // P1 FIX: Single-pass aggregation for efficiency
    let totalDurationSeconds = 0;
    let sumWpm = 0;
    let totalFillerWords = 0;
    let totalAccuracy = 0;

    for (const s of sessionHistory) {
        const duration = s.duration || 0;
        totalDurationSeconds += duration;

        const sessionMetrics = getSessionAnalysisMetrics(s);
        const sessionWpm = sessionMetrics.wpm;

        sumWpm += sessionWpm;

        totalFillerWords += sessionMetrics.fillerCount;
        totalAccuracy += typeof s.accuracy === 'number'
            ? s.accuracy * 100
            : sessionMetrics.clarityScore;
    }

    // totalPracticeTime: rounded for display (e.g., "1 min")
    const totalPracticeTime = Math.round(totalDurationSeconds / 60);
    // totalPracticeTimeMinutes: precise for rate calculations (industry standard)
    const totalPracticeTimeMinutes = totalDurationSeconds / 60;

    const averageWPM = Math.round(sumWpm / totalSessions);
    // Industry standard: Filler Rate = Total Fillers / Total Speaking Time (precise minutes)
    const avgFillerWordsPerMin = totalPracticeTimeMinutes > 0
        ? (totalFillerWords / totalPracticeTimeMinutes).toFixed(1)
        : "0.0";
    const avgAccuracy = totalSessions > 0 ? (totalAccuracy / totalSessions).toFixed(1) : "0.0";

    const chartData = sessionHistory.slice(0, 10).map(s => {
        const duration = s.duration || 0;
        const sessionMetrics = getSessionAnalysisMetrics(s);
        const totalFillerCount = sessionMetrics.fillerCount;

        const durationMins = duration / 60;
        const fwPerMin = durationMins > 0 ? totalFillerCount / durationMins : 0;

        return {
            date: new Date(s.created_at).toLocaleDateString(),
            'FW/min': duration > 0 ? fwPerMin.toFixed(2) : "0.0",
            clarity: sessionMetrics.clarityScore
        };
    }).reverse();

    return { totalSessions, totalPracticeTime, averageWPM, avgFillerWordsPerMin, avgAccuracy, chartData };
};

export const calculateFillerWordTrends = (sessionHistory: PracticeSession[]) => {
    const trendData: { [key: string]: { current: number; previous: number } } = {};
    if (sessionHistory.length > 0) {
        // Industry Standard: Use 5-session rolling average for stable trend analysis
        const getAvgForWindow = (window: PracticeSession[]): { [key: string]: number } => {
            if (window.length === 0) return {};
            const counts: { [key: string]: number } = {};
            window.forEach(s => {
                Object.entries(getSessionAnalysisMetrics(s).fillerData || {}).forEach(([word, data]) => {
                    if (word !== 'total') {
                        counts[word] = (counts[word] || 0) + data.count;
                    }
                });
            });
            const avgCounts: { [key: string]: number } = {};
            Object.keys(counts).forEach(k => avgCounts[k] = counts[k] / window.length);
            return avgCounts;
        };

        const currentWindow = sessionHistory.slice(0, 5);
        const previousWindow = sessionHistory.slice(5, 10);

        const currentAvgs = getAvgForWindow(currentWindow);
        const previousAvgs = getAvgForWindow(previousWindow);

        const allKeys = new Set([
            ...Object.keys(currentAvgs),
            ...Object.keys(previousAvgs)
        ]);

        allKeys.forEach(key => {
            trendData[key] = {
                current: currentAvgs[key] || 0,
                previous: previousAvgs[key] || 0
            };
        });
    }
    return trendData;
};

export const calculateTopFillerWords = (sessionHistory: PracticeSession[]) => {
    const counts = sessionHistory.reduce((acc, s) => {
        const fillers = getSessionAnalysisMetrics(s).fillerData || {};
        for (const [word, data] of Object.entries(fillers)) {
            if (word !== 'total' && data.count > 0) {
                acc[word] = (acc[word] || 0) + data.count;
            }
        }
        return acc;
    }, {} as Record<string, number>);

    return Object.entries(counts)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count);
};

export const calculateAccuracyData = (sessionHistory: PracticeSession[]) => {
    return sessionHistory
        .filter(s => s.ground_truth && s.transcript && s.engine)
        .map(s => {
            const wer = calculateWordErrorRate(s.ground_truth!, s.transcript!);
            return {
                date: new Date(s.created_at).toLocaleDateString(),
                accuracy: Math.max(0, Math.round((1 - wer) * 100)),
                engine: s.engine!,
            };
        })
        .reverse();
};
