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