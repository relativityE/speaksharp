import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, Clock, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const calculateTrends = (history) => {
    if (!history || history.length === 0) {
        return {
            avgFillerWordsPerMin: 0,
            totalSessions: 0,
            totalPracticeTime: 0,
            chartData: [],
            topFillerWords: []
        };
    }

    const totalSessions = history.length;
    const totalDuration = history.reduce((sum, session) => sum + (session.duration || 0), 0);
    const totalFillerWords = history.reduce((sum, session) => {
        if (!session.filler_words) return sum;
        return sum + Object.values(session.filler_words).reduce((a, b) => a + b, 0);
    }, 0);

    const avgFillerWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;

    const chartData = history.map(s => ({
        date: new Date(s.created_at).toLocaleDateString(),
        'FW/min': s.duration > 0 ? (Object.values(s.filler_words || {}).reduce((a, b) => a + b, 0) / (s.duration / 60)).toFixed(1) : 0,
    })).reverse();

    const allFillerCounts = history.reduce((acc, session) => {
        if (!session.filler_words) return acc;
        for (const word in session.filler_words) {
            acc[word] = (acc[word] || 0) + session.filler_words[word];
        }
        return acc;
    }, {});

    const topFillerWords = Object.entries(allFillerCounts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, value]) => ({ name, value }));

    return {
        avgFillerWordsPerMin: avgFillerWordsPerMin.toFixed(1),
        totalSessions,
        totalPracticeTime: Math.round(totalDuration / 60),
        chartData,
        topFillerWords
    };
};

const EmptyState = () => {
    const navigate = useNavigate();
    return (
        <div className="flex flex-col items-center justify-center p-20 text-center rounded-lg bg-card-bg">
            <h2 className="text-3xl font-bold text-light-text">Your Progress Awaits</h2>
            <p className="max-w-md mx-auto my-4 text-muted-text">
                Complete your first session to unlock your personal analytics dashboard and start tracking your journey to confident speaking.
            </p>
            <Button onClick={() => navigate('/session')} className="bg-accent-blue text-charcoal hover:bg-accent-blue/90">
                Start Your First Session
            </Button>
        </div>
    );
};

const StatCard = ({ icon, label, value, unit }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-text">{label}</CardTitle>
            {icon}
        </CardHeader>
        <CardContent>
            <div className="text-4xl font-bold text-light-text">
                {value}
                {unit && <span className="ml-2 text-lg font-normal text-muted-text">{unit}</span>}
            </div>
        </CardContent>
    </Card>
);

const SessionHistoryItem = ({ session }) => (
    <Card className="p-4 transition-all duration-200 hover:bg-white/5">
        <div className="flex items-center justify-between">
            <div>
                <p className="font-semibold text-light-text">{new Date(session.created_at).toLocaleDateString()}</p>
                <p className="text-sm text-muted-text">{new Date(session.created_at).toLocaleTimeString()}</p>
            </div>
            <div className="text-right">
                <p className="font-semibold text-light-text">{(Object.values(session.filler_words || {}).reduce((a, b) => a + b, 0))} filler words</p>
                <p className="text-sm text-muted-text">{session.duration}s duration</p>
            </div>
        </div>
    </Card>
);


export const AnalyticsDashboard = ({ sessionHistory }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return <EmptyState />;
    }

    const trends = calculateTrends(sessionHistory);

    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
                <StatCard icon={<Hash size={20} className="text-muted-text" />} label="Total Sessions" value={trends.totalSessions} />
                <StatCard icon={<TrendingUp size={20} className="text-muted-text" />} label="Avg. Filler Words / Min" value={trends.avgFillerWordsPerMin} />
                <StatCard icon={<Clock size={20} className="text-muted-text" />} label="Total Practice Time" value={trends.totalPracticeTime} unit="mins" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="col-span-1 lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Filler Word Trend</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={trends.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--bg-charcoal)" />
                                <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'var(--bg-charcoal)' }}
                                    contentStyle={{
                                        backgroundColor: 'var(--bg-card)',
                                        border: '1px solid var(--bg-charcoal)',
                                        color: 'var(--text-light)'
                                    }}
                                />
                                <Line type="monotone" dataKey="FW/min" stroke="var(--accent-blue)" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 8 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Top Filler Words</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={trends.topFillerWords} layout="vertical" margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" stroke="var(--text-muted)" fontSize={14} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'var(--bg-charcoal)' }}
                                    contentStyle={{
                                        backgroundColor: 'var(--bg-card)',
                                        border: '1px solid var(--bg-charcoal)',
                                        color: 'var(--text-light)'
                                    }}
                                />
                                <Bar dataKey="value" fill="var(--accent-blue)" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Session History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {sessionHistory.slice(0, 10).map(session => (
                        <SessionHistoryItem key={session.id} session={session} />
                    ))}
                </CardContent>
            </Card>
        </div>
    );
};
