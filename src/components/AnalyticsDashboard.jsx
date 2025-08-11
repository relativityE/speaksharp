import React from 'react';

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


export const AnalyticsDashboard = ({ sessionHistory }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return (
            <div className="card">
                <h2>No Session Data</h2>
                <p>You have not completed any sessions yet. Start a new session to see your analytics.</p>
            </div>
        );
    }

    const trends = calculateTrends(sessionHistory);
    const latestSession = sessionHistory[sessionHistory.length - 1];
    const colors = ['blue', 'green', 'orange', 'purple', 'red', 'pink'];

    const formatFillerWord = (word) => {
        if (word.includes('_')) {
            return word.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    };

    return (
        <div className="space-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Key Stats Section */}
            <div className="features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div className="card" style={{textAlign: 'center'}}>
                    <h3>Total Sessions</h3>
                    <div className="filler-count">{trends.totalSessions}</div>
                </div>
                <div className="card" style={{textAlign: 'center'}}>
                    <h3>Avg. Filler Words</h3>
                    <div className="filler-count">{trends.avgFillerWords}</div>
                </div>
                <div className="card" style={{textAlign: 'center'}}>
                    <h3>Avg. Words/Min</h3>
                    <div className="filler-count">{trends.avgWordsPerMin}</div>
                </div>
            </div>

            {/* Latest Session Details */}
            <div className="card">
                <h2>
                    <span className="chart-icon"></span>
                    Latest Session Details
                </h2>
                <p>Breakdown of filler words from your most recent session on {new Date(latestSession.date).toLocaleDateString()}.</p>

                <div className="filler-grid">
                    {Object.entries(latestSession.fillerCounts).map(([word, count], index) => (
                        <div className="filler-item" key={word}>
                            <div className={`filler-count ${colors[index % colors.length]}`}>{count}</div>
                            <div className="filler-label">{formatFillerWord(word)}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Session History Section */}
            <div className="card">
                <h2>Session History</h2>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                    {sessionHistory.slice().reverse().map(session => (
                        <li key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 8px', borderBottom: '1px solid #eee' }}>
                            <span>{new Date(session.date).toLocaleString()}</span>
                            <span>{session.totalFillerWords} filler words</span>
                            <span>{(session.duration)}s duration</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
