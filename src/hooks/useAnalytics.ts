import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { PracticeSession } from '@/types/session';

interface AnalyticsData {
    topFillerWords: { word: string; count: number }[];
    accuracyData: { date: string; accuracy: number; engine: string }[];
}

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

export const useAnalytics = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [analyticsData, setAnalyticsData] = useState<AnalyticsData>({
        topFillerWords: [],
        accuracyData: [],
    });

    useEffect(() => {
        const fetchAnalyticsData = async () => {
            try {
                const { data: sessions, error: sessionsError } = await supabase
                    .from('practice_sessions')
                    .select('*, ground_truth')
                    .order('created_at', { ascending: false })
                    .limit(10);

                if (sessionsError) {
                    throw sessionsError;
                }

                if (!sessions) {
                    setAnalyticsData({ topFillerWords: [], accuracyData: [] });
                    return;
                }

                const topFillerWords = (sessions as PracticeSession[])
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

                const accuracyData = (sessions as PracticeSession[])
                    .filter(s => s.ground_truth && s.transcript)
                    .map(s => {
                        const wer = calculateWER(s.ground_truth!, s.transcript!);
                        return {
                            date: new Date(s.created_at).toLocaleDateString(),
                            accuracy: (1 - wer) * 100,
                            engine: s.engine,
                        };
                    })
                    .reverse();

                setAnalyticsData({ topFillerWords, accuracyData });
            } catch (err: unknown) {
                setError(err instanceof Error ? err : new Error('An unknown error occurred'));
            } finally {
                setLoading(false);
            }
        };

        fetchAnalyticsData();
    }, []);

    return { ...analyticsData, loading, error };
};