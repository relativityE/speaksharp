export const calculateTrends = (history) => {
    if (!history || history.length === 0) {
        return {
            avgFillerWordsPerMin: "0.0",
            totalSessions: 0,
            totalPracticeTime: 0,
            avgAccuracy: "0.0",
            chartData: [],
            topFillerWords: []
        };
    }

    const totalSessions = history.length;
    const getFillersCount = (session) => {
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

    const avgFillerWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;
    const avgAccuracy = sessionCountWithAccuracy > 0 ? (totalAccuracy / sessionCountWithAccuracy) * 100 : 0;

    const chartData = history.map(s => {
        const duration = Number(s.duration);
        const fillerCount = getFillersCount(s);
        const fwPerMin = duration > 0 ? (fillerCount / (duration / 60)).toFixed(1) : "0.0";
        return {
            date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            'FW/min': fwPerMin,
        };
    }).reverse();

    const allFillerCounts = history.reduce((acc, session) => {
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
        totalPracticeTime: Math.round(totalDuration / 60),
        avgAccuracy: avgAccuracy.toFixed(1),
        chartData,
        topFillerWords
    };
};
