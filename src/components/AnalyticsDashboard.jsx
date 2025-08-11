import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, Clock, Hash, Download } from 'lucide-react';

const calculateTrends = (history) => {
    if (!history || history.length === 0) {
        return {
            avgFillerWords: 0,
            avgWordsPerMin: 0,
            totalSessions: 0,
            totalPracticeTime: 0,
            chartData: [],
            topFillerWords: []
        };
    }

    const totalSessions = history.length;
    const totalFillerWords = history.reduce((sum, session) => sum + session.totalFillerWords, 0);
    const totalDuration = history.reduce((sum, session) => sum + session.duration, 0);
    const avgWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;

    const chartData = history.map(s => ({
        date: new Date(s.date).toLocaleDateString(),
        'Filler Words per Minute': s.duration > 0 ? (s.totalFillerWords / (s.duration / 60)).toFixed(1) : 0,
    })).reverse();

    const allFillerCounts = history.reduce((acc, session) => {
        for (const word in session.fillerCounts) {
            acc[word] = (acc[word] || 0) + session.fillerCounts[word];
        }
        return acc;
    }, {});

    const topFillerWords = Object.entries(allFillerCounts).sort(([,a],[,b]) => b-a).slice(0, 5);

    return {
        avgFillerWords: (totalFillerWords / totalSessions).toFixed(1),
        avgWordsPerMin: avgWordsPerMin.toFixed(1),
        totalSessions: totalSessions,
        totalPracticeTime: Math.round(totalDuration / 60),
        chartData,
        topFillerWords
    };
};

const EmptyState = () => {
    const navigate = useNavigate();
    return (
        <div className="card" style={{ textAlign: 'center', padding: '80px' }}>
            <h2 className="h2" style={{ color: 'var(--color-text-primary)' }}>Your Progress Awaits</h2>
            <p className="p" style={{ maxWidth: '450px', margin: '16px auto 32px auto' }}>
                Complete your first session to unlock your personal analytics dashboard and start tracking your journey to confident speaking.
            </p>
            <button onClick={() => navigate('/session')} className="btn btn-primary">Start Your First Session</button>
        </div>
    );
};

const StatCard = ({ icon, label, value, unit }) => (
    <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}>
            {icon}
            <span style={{ marginLeft: '8px', fontSize: '0.875rem' }}>{label}</span>
        </div>
        <div style={{ fontSize: '2.25rem', fontWeight: '700', color: 'var(--color-text-primary)', marginTop: '8px' }}>
            {value} <span style={{ fontSize: '1rem', color: 'var(--color-text-secondary)' }}>{unit}</span>
        </div>
    </div>
);

export const AnalyticsDashboard = ({ sessionHistory, exportSessions }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return <EmptyState />;
    }

    const trends = calculateTrends(sessionHistory);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                <StatCard icon={<Hash size={16} />} label="Total Sessions" value={trends.totalSessions} />
                <StatCard icon={<TrendingUp size={16} />} label="Avg. Filler Words / Min" value={trends.avgFillerWords} />
                <StatCard icon={<Clock size={16} />} label="Total Practice Time" value={trends.totalPracticeTime} unit="mins" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="card">
                        <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '16px' }}>Filler Word Trend</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={trends.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                                <XAxis dataKey="date" stroke="var(--color-text-secondary)" fontSize="0.75rem" />
                                <YAxis stroke="var(--color-text-secondary)" fontSize="0.75rem" />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }} />
                                <Line type="monotone" dataKey="Filler Words per Minute" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 8 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="card">
                         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 className="h3" style={{ color: 'var(--color-text-primary)' }}>Session History</h3>
                            <button className="btn btn-secondary" onClick={exportSessions}><Download size={16} style={{marginRight: '8px'}} /> Export My Data</button>
                        </div>
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                            {sessionHistory.slice(0, 5).map(session => (
                                <li key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--color-border)' }}>
                                    <span>{new Date(session.date).toLocaleString()}</span>
                                    <span>{session.totalFillerWords} filler words</span>
                                    <span>{(session.duration)}s duration</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="card">
                    <h3 className="h3" style={{ color: 'var(--color-text-primary)', marginBottom: '16px' }}>Top Filler Words</h3>
                     <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={trends.topFillerWords} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                            <XAxis type="number" hide />
                            <YAxis type="category" dataKey="0" stroke="var(--color-text-secondary)" fontSize="0.875rem" width={80} />
                            <Tooltip cursor={{fill: 'var(--color-bg-primary)'}} contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}/>
                            <Bar dataKey="1" fill="var(--color-accent)" background={{ fill: 'var(--color-bg-primary)' }} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};
