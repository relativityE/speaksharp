import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LabelList } from 'recharts';
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
        if (!session.filler_counts) return sum;
        return sum + Object.values(session.filler_counts).reduce((a, b) => a + b, 0);
    }, 0);

    const avgFillerWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;

    const chartData = history.map(s => ({
        date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        'FW/min': s.duration > 0 ? (Object.values(s.filler_counts || {}).reduce((a, b) => a + b, 0) / (s.duration / 60)).toFixed(1) : 0,
    })).reverse();

    const allFillerCounts = history.reduce((acc, session) => {
        if (!session.filler_counts) return acc;
        for (const word in session.filler_counts) {
            acc[word] = (acc[word] || 0) + session.filler_counts[word];
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
        <Card className="flex flex-col items-center justify-center p-12 text-center">
            <h2 className="text-2xl font-bold text-foreground">Ready to See Your Progress?</h2>
            <p className="max-w-md mx-auto my-4 text-muted-foreground">
                Complete a session to start tracking your journey to confident speaking.
            </p>
            <Button onClick={() => navigate('/session')}>
                Start Your First Session
            </Button>
        </Card>
    );
};

const StatCard = ({ icon, label, value, unit }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            {icon}
        </CardHeader>
        <CardContent>
            <div className="text-4xl font-bold text-foreground">
                {value}
                {unit && <span className="ml-2 text-lg font-normal text-muted-foreground">{unit}</span>}
            </div>
        </CardContent>
    </Card>
);

const SessionHistoryItem = ({ session }) => {
    const totalFillers = Object.values(session.filler_counts || {}).reduce((a, b) => a + b, 0);
    const durationMins = (session.duration / 60).toFixed(1);

    return (
        <div className="p-4 transition-all duration-200 rounded-lg hover:bg-secondary">
            <div className="flex items-center justify-between">
                <div>
                    <p className="font-semibold text-foreground">{new Date(session.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    <p className="text-sm text-muted-foreground">{new Date(session.created_at).toLocaleTimeString()}</p>
                </div>
                <div className="text-right">
                    <p className="font-semibold text-foreground">{totalFillers} filler words</p>
                    <p className="text-sm text-muted-foreground">{durationMins} min duration</p>
                </div>
            </div>
        </div>
    );
};

export const AnalyticsDashboard = ({ sessionHistory }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return <EmptyState />;
    }

    const trends = calculateTrends(sessionHistory);

    return (
        <div className="space-y-8">
            <div className="grid gap-6 md:grid-cols-3">
                <StatCard icon={<Hash size={20} className="text-muted-foreground" />} label="Total Sessions" value={trends.totalSessions} />
                <StatCard icon={<TrendingUp size={20} className="text-muted-foreground" />} label="Avg. Filler Words / Min" value={trends.avgFillerWordsPerMin} />
                <StatCard icon={<Clock size={20} className="text-muted-foreground" />} label="Total Practice Time" value={trends.totalPracticeTime} unit="mins" />
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
                <Card className="col-span-1 lg:col-span-3">
                    <CardHeader>
                        <CardTitle>Filler Word Trend</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={trends.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: 'hsla(var(--secondary))' }}
                                    contentStyle={{
                                        backgroundColor: 'hsl(var(--card))',
                                        borderColor: 'hsl(var(--border))',
                                        color: 'hsl(var(--foreground))'
                                    }}
                                />
                                <Line type="monotone" dataKey="FW/min" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="col-span-1 lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Top Filler Words</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={trends.topFillerWords} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={14} tickLine={false} axisLine={false} width={80} />
                                <Tooltip
                                    cursor={{ fill: 'hsla(var(--secondary))' }}
                                    contentStyle={{
                                        backgroundColor: 'hsl(var(--card))',
                                        borderColor: 'hsl(var(--border))',
                                        color: 'hsl(var(--foreground))'
                                    }}
                                />
                                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                                    <LabelList dataKey="value" position="right" className="fill-foreground" />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Session History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {sessionHistory.slice(0, 10).map(session => (
                        <SessionHistoryItem key={session.id} session={session} />
                    ))}
                </CardContent>
            </Card>
        </div>
    );
};
