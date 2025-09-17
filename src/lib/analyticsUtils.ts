import { formatDate } from './dateUtils';
import { FILLER_WORD_KEYS } from '../config';
import type { PracticeSession } from '../types/session';
import type { FillerWordTrends } from '../types/analytics';

interface OverallStats {
  avgFillerWordsPerMin: string;
  totalSessions: number;
  totalPracticeTime: string;
  avgAccuracy: string;
  chartData: {
    date: string;
    'FW/min': string;
  }[];
  topFillerWords: {
    name:string;
    value: number;
  }[];
}

/**
 * Calculates overall aggregate statistics for a collection of sessions.
 * @param {Array} history - An array of session objects.
 * @returns {Object} An object containing aggregate stats like averages and totals.
 */
export const calculateOverallStats = (history: PracticeSession[]): OverallStats => {
    if (!history || history.length === 0) {
        return {
            avgFillerWordsPerMin: "0.0",
            totalSessions: 0,
            totalPracticeTime: "0.0",
            avgAccuracy: "0.0",
            chartData: [],
            topFillerWords: []
        };
    }

    const totalSessions = history.length;
    const getFillersCount = (session: PracticeSession): number => {
        const fillerData = session.filler_words || {};
        return Object.values(fillerData).reduce((sum, data) => sum + (data.count || 0), 0);
    };

    const { totalDuration, totalFillerWords, totalAccuracy, sessionCountWithAccuracy } = history.reduce((acc, session) => {
        const duration = Number(session.duration);
        if (!isNaN(duration) && duration > 0) {
            acc.totalDuration += duration;
            acc.totalFillerWords += getFillersCount(session);
            if (session.accuracy) {
                acc.totalAccuracy += session.accuracy;
                acc.sessionCountWithAccuracy++;
            }
        }
        return acc;
    }, { totalDuration: 0, totalFillerWords: 0, totalAccuracy: 0, sessionCountWithAccuracy: 0 });

    const totalDurationMinutes = totalDuration / 60;
    const avgFillerWordsPerMin = totalDurationMinutes >= 0.5 ? (totalFillerWords / totalDurationMinutes) : 0;
    const avgAccuracy = sessionCountWithAccuracy > 0 ? (totalAccuracy / sessionCountWithAccuracy) * 100 : 0;

    const chartData = history.map(s => {
        const duration = Number(s.duration);
        const fillerCount = getFillersCount(s);
        const fwPerMin = duration > 0 ? (fillerCount / (duration / 60)).toFixed(1) : "0.0";
        return {
            date: formatDate(s.created_at),
            'FW/min': fwPerMin,
        };
    }).reverse();

    const allFillerCounts = history.reduce((acc: { [key: string]: number }, session) => {
        const fillerData = session.filler_words || {};
        for (const word in fillerData) {
            acc[word] = (acc[word] || 0) + (fillerData[word].count || 0);
        }
        return acc;
    }, {});

    const topFillerWords = Object.entries(allFillerCounts)
        .sort(([keyA, a], [keyB, b]) => b - a || keyB.localeCompare(keyA))
        .slice(0, 5)
        .map(([name, value]) => ({ name, value }));

    return {
        avgFillerWordsPerMin: avgFillerWordsPerMin.toFixed(1),
        totalSessions,
        totalPracticeTime: totalDurationMinutes.toFixed(1),
        avgAccuracy: avgAccuracy.toFixed(1),
        chartData,
        topFillerWords
    };
};


const getSeverity = (count: number): 'red' | 'orange' | 'yellow' | 'green' => {
    if (count >= 10) return 'red';
    if (count >= 7) return 'orange';
    if (count >= 4) return 'yellow';
    return 'green';
};

const formatTooltip = (word: string, currentCount: number, prevCount: number | null): string => {
    if (prevCount === null) {
        return `Count: ${currentCount}`;
    }
    if (currentCount > prevCount) {
        const change = prevCount > 0 ? Math.round(((currentCount - prevCount) / prevCount) * 100) : 100;
        return `${change}% increase from last session (${prevCount} to ${currentCount})`;
    }
    if (currentCount < prevCount) {
        const change = Math.round(((prevCount - currentCount) / prevCount) * 100);
        return `${change}% decrease from last session (${prevCount} to ${currentCount})`;
    }
    return `No change from last session (Count: ${currentCount})`;
};


/**
 * Calculates trends for filler words across multiple sessions for a table view.
 * @param {Array} sessions - An array of session objects, sorted from most recent to oldest.
 * @returns {Object} An object where keys are filler words and values are arrays of trend data.
 */
export const calculateFillerWordTrends = (sessions: PracticeSession[]): FillerWordTrends => {
    if (!sessions || sessions.length === 0) {
        return {};
    }

    const trendData: FillerWordTrends = {};
    const fillerWords = Object.values(FILLER_WORD_KEYS as Record<string, string>);

    for (const word of fillerWords) {
        trendData[word] = sessions.map((session, index) => {
            const prevSession = sessions[index + 1]; // The next session in the array is the previous one in time
            const currentCount = session.filler_words?.[word]?.count || 0;
            const prevCount = prevSession ? (prevSession.filler_words?.[word]?.count || 0) : null;

            return {
                count: currentCount,
                severity: getSeverity(currentCount),
                tooltip: formatTooltip(word, currentCount, prevCount),
            };
        });
    }

    return trendData;
};
