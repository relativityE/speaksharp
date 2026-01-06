import type { PracticeSession } from '@/types/session';

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
            avgWpm: 0,
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
    let totalClarity = 0;

    for (const s of sessionHistory) {
        const duration = s.duration || 0;
        totalDurationSeconds += duration;

        // Use DB-backed metrics if available, otherwise calculate
        const durationMins = duration / 60;
        const sessionWpm = s.wpm ?? (durationMins > 0 ? (s.total_words || 0) / durationMins : 0);

        sumWpm += sessionWpm;

        totalFillerWords += Object.entries(s.filler_words || {}).reduce((sum, [word, d]) => {
            return word === 'total' ? sum : sum + (d.count || 0);
        }, 0);
        // Use clarity_score for overall metrics, fallback to accuracy for legacy
        const sessionClarity = s.clarity_score ?? (s.accuracy ? s.accuracy * 100 : 0);
        totalClarity += sessionClarity;
    }

    // totalPracticeTime: rounded for display (e.g., "1 min")
    const totalPracticeTime = Math.round(totalDurationSeconds / 60);
    // totalPracticeTimeMinutes: precise for rate calculations (industry standard)
    const totalPracticeTimeMinutes = totalDurationSeconds / 60;

    const avgWpm = Math.round(sumWpm / totalSessions);
    // Industry standard: Filler Rate = Total Fillers / Total Speaking Time (precise minutes)
    const avgFillerWordsPerMin = totalPracticeTimeMinutes > 0
        ? (totalFillerWords / totalPracticeTimeMinutes).toFixed(1)
        : "0.0";
    const avgAccuracy = totalSessions > 0 ? (totalClarity / totalSessions).toFixed(1) : "0.0";

    // Chart data - limit to last 10 sessions
    const chartData = sessionHistory.slice(0, 10).map(s => ({
        date: new Date(s.created_at).toLocaleDateString(),
        'FW/min': s.duration > 0 ? ((Object.entries(s.filler_words || {}).reduce((sum, [word, d]) => word === 'total' ? sum : sum + (d.count || 0), 0)) / (s.duration / 60)).toFixed(2) : "0.0",
        clarity: s.clarity_score ?? (s.duration > 0 ? 100 - (((Object.entries(s.filler_words || {}).reduce((sum, [word, d]) => word === 'total' ? sum : sum + (d.count || 0), 0)) / (s.duration / 60)) * 2) : 100)
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

export const calculateTopFillerWords = (sessionHistory: PracticeSession[]) => {
    return sessionHistory
        .flatMap(s => Object.entries(s.filler_words || {}).map(([word, data]) => ({ word, count: data.count })))
        .reduce((acc, { word, count }) => {
            if (word !== 'total') {
                const existingWord = acc.find(item => item.word === word);
                if (existingWord) {
                    existingWord.count += count;
                } else {
                    acc.push({ word, count });
                }
            }
            return acc;
        }, [] as { word: string; count: number }[])
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);
};

// Function to calculate Word Error Rate (WER)
const calculateWER = (groundTruth: string, hypothesis: string): number => {
    const gtWords = groundTruth.toLowerCase().split(' ');
    const hypWords = hypothesis.toLowerCase().split(' ');

    const dp = Array(gtWords.length + 1)
        .fill(0)
        .map(() => Array(hypWords.length + 1).fill(0));

    for (let i = 0; i <= gtWords.length; i++) {
        for (let j = 0; j <= hypWords.length; j++) {
            if (i === 0) {
                dp[i][j] = j;
            } else if (j === 0) {
                dp[i][j] = i;
            } else if (gtWords[i - 1] === hypWords[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }

    return dp[gtWords.length][hypWords.length] / gtWords.length;
};

export const calculateAccuracyData = (sessionHistory: PracticeSession[]) => {
    return sessionHistory
        .filter(s => s.ground_truth && s.transcript && s.engine)
        .map(s => {
            const wer = calculateWER(s.ground_truth!, s.transcript!);
            return {
                date: new Date(s.created_at).toLocaleDateString(),
                accuracy: (1 - wer) * 100,
                engine: s.engine!,
            };
        })
        .reverse();
};