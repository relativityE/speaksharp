import React from 'react';
import { BarChart, Clock, Hash, TrendingUp, Zap } from 'lucide-react';

const calculateTrends = (history) => {
    if (!history || history.length === 0) {
        return {
            avgFillerWords: 0,
            avgWordsPerMin: 0,
            totalSessions: 0,
        };
    }

    const totalSessions = history.length;
    const totalFillerWords = history.reduce((sum, session) => sum + session.totalFillerWords, 0);
    const totalDuration = history.reduce((sum, session) => sum + session.duration, 0);

    const avgWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;

    return {
        avgFillerWords: (totalFillerWords / totalSessions).toFixed(1),
        avgWordsPerMin: avgWordsPerMin.toFixed(1),
        totalSessions: totalSessions,
    };
};

const StatCard = ({ icon, label, value, unit }) => (
    <div className="card card-metric p-6 flex flex-col items-center justify-center text-center">
        <div className="text-4xl font-bold text-white">{value}</div>
        <div className="text-sm text-primary-foreground/80 mt-1">{label}</div>
    </div>
);


export const AnalyticsDashboard = ({ sessionHistory }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return (
            <div className="card p-8 text-center">
                <h2 className="h2">No Session Data</h2>
                <p className="text-muted mt-2">You have not completed any sessions yet. Start a new session to see your analytics.</p>
            </div>
        );
    }

    const trends = calculateTrends(sessionHistory);
    const latestSession = sessionHistory[sessionHistory.length - 1];

    const formatFillerWord = (word) => {
        if (word.includes('_')) {
            return word.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    };

    return (
        <div className="space-y-8">
            {/* Key Stats Section */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <StatCard icon={<Hash />} label="Total Sessions" value={trends.totalSessions} />
                <StatCard icon={<TrendingUp />} label="Avg. Filler Words" value={trends.avgFillerWords} />
                <StatCard icon={<Clock />} label="Avg. Words/Min" value={trends.avgWordsPerMin} />
            </div>

            {/* Latest Session Details */}
            <div className="card p-6">
                <h2 className="h2 flex items-center">
                    <Zap className="mr-2 h-5 w-5 text-primary" />
                    Latest Session Details
                </h2>
                <p className="text-muted mt-1">Breakdown of filler words from your most recent session on {new Date(latestSession.date).toLocaleDateString()}.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-6">
                    {Object.entries(latestSession.fillerCounts).map(([word, count]) => (
                        <div className="bg-secondary rounded-lg p-4 text-center" key={word}>
                            <div className="text-3xl font-bold text-primary">{count}</div>
                            <div className="text-sm text-muted-foreground">{formatFillerWord(word)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Session History Section */}
            <div className="card p-6">
                <h2 className="h2 flex items-center">
                    <BarChart className="mr-2 h-5 w-5 text-primary" />
                    Session History
                </h2>
                <ul className="space-y-4 mt-4">
                    {sessionHistory.slice().reverse().map(session => (
                        <li key={session.id} className="flex justify-between items-center bg-secondary p-4 rounded-lg">
                            <span className="font-medium">{new Date(session.date).toLocaleString()}</span>
                            <span className="text-muted-foreground">{session.totalFillerWords} filler words</span>
                            <span className="text-sm text-muted-foreground">{(session.duration)}s duration</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
