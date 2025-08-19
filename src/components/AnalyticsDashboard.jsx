import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LabelList } from 'recharts';
import { TrendingUp, Clock, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export const calculateTrends = (history) => {
    if (!history || history.length === 0) {
        return {
            avgFillerWordsPerMin: "0.0",
            totalSessions: 0,
            totalPracticeTime: 0,
            chartData: [],
            topFillerWords: []
        };
    }

    const totalSessions = history.length;
    const getFillersCount = (session) => {
        const safeSum = (values) => {
            return values.reduce((sum, value) => {
                const num = Number(value);
                return sum + (isNaN(num) ? 0 : num);
            }, 0);
        };

        const fillerData = session.filler_words || session.filler_data;
        if (!fillerData) {
            if (session.filler_counts) { // Backwards compatibility for old schema
                return safeSum(Object.values(session.filler_counts));
            }
            return 0;
        }

        if (Array.isArray(fillerData)) { // Handles { word: 'like', count: 12 }
            return safeSum(fillerData.map(item => item.count));
        }

        // Handles { 'like': { count: 5 } } or { 'like': 5 }
        const counts = Object.values(fillerData).map(data => (data && data.count) || data);
        return safeSum(counts);
    };

    const { totalDuration, totalFillerWords } = history.reduce((acc, session) => {
        const duration = Number(session.duration);
        // Only include sessions with a valid, positive duration in calculations
        if (!isNaN(duration) && duration > 0) {
            acc.totalDuration += duration;
            acc.totalFillerWords += getFillersCount(session);
        }
        return acc;
    }, { totalDuration: 0, totalFillerWords: 0 });
    const avgFillerWordsPerMin = totalDuration > 0 ? (totalFillerWords / (totalDuration / 60)) : 0;

    const chartData = history.map(s => {
        // FIX: Ensure duration is a number for this calculation as well.
        const duration = Number(s.duration);
        const validDuration = isNaN(duration) ? 0 : duration;
        const fillerCount = getFillersCount(s);
        const fwPerMin = validDuration > 0 ? (fillerCount / (validDuration / 60)).toFixed(1) : "0.0";
        return {
            date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            'FW/min': fwPerMin,
        };
    }).reverse();

    const allFillerCounts = history.reduce((acc, session) => {
        const fillerData = session.filler_words || session.filler_data || session.filler_counts;
        if (!fillerData) return acc;

        // FIX: Handle array-based filler_words schema to prevent [object Object] bug
        if (Array.isArray(fillerData)) {
            for (const item of fillerData) {
                if (item.word && typeof item.count === 'number') {
                    acc[item.word] = (acc[item.word] || 0) + item.count;
                }
            }
        } else { // Handle object-based schemas
            for (const word in fillerData) {
                const count = (typeof fillerData[word] === 'object' && fillerData[word] !== null)
                    ? fillerData[word].count
                    : fillerData[word];

                if (typeof count === 'number') {
                  acc[word] = (acc[word] || 0) + count;
                }
            }
        }
        return acc;
    }, {});

    const topFillerWords = Object.entries(allFillerCounts).sort(([keyA, a], [keyB, b]) => b - a || keyA.localeCompare(keyB)).slice(0, 5).map(([name, value]) => ({ name, value }));

    return {
        avgFillerWordsPerMin: avgFillerWordsPerMin.toFixed(1),
        totalSessions,
        totalPracticeTime: Math.round(totalDuration / 60),
        chartData,
        topFillerWords
    };
};

import { Sparkles, Layers } from 'lucide-react';

const EmptyState = () => {
    const navigate = useNavigate();
    return (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
            <Sparkles className="w-12 h-12 text-yellow-400 mb-4" />
            <h2 className="text-2xl font-bold text-foreground">Your Dashboard Awaits!</h2>
            <p className="max-w-md mx-auto my-4 text-muted-foreground text-base">
                Your speaking insights will appear here once you complete a session. Let's get started!
            </p>
            <Button onClick={() => navigate('/session')}>
                Start a New Session →
            </Button>
        </Card>
    );
};

const StatCard = ({ icon, label, value, unit, className }) => (
    <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-base font-medium text-muted-foreground">{label}</CardTitle>
            {icon}
        </CardHeader>
        <CardContent>
            <div className="text-5xl font-bold text-foreground">
                {value}
                {unit && <span className="ml-2 text-2xl font-normal text-muted-foreground">{unit}</span>}
            </div>
        </CardContent>
    </Card>
);

const SessionHistoryItem = ({ session }) => {
    const getFillersCount = (s) => {
        const fillerData = s.filler_words || s.filler_data || s.filler_counts;
        if (!fillerData) return 0;
        if (Array.isArray(fillerData)) {
            return fillerData.reduce((sum, item) => sum + (item.count || 0), 0);
        }
        return Object.values(fillerData).reduce((sum, data) => sum + (data.count || data || 0), 0);
    };
    const totalFillers = getFillersCount(session);
    const durationMins = (session.duration / 60).toFixed(1);

    return (
        <Card className="p-4 transition-all duration-200 hover:bg-secondary/50">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <p className="font-semibold text-foreground text-lg">{session.title || `Session from ${new Date(session.created_at).toLocaleDateString()}`}</p>
                    <p className="text-sm text-muted-foreground">
                        {new Date(session.created_at).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                </div>
                <div className="flex items-center gap-6 text-right w-full sm:w-auto">
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Filler Words</p>
                        <p className="font-bold text-lg text-foreground">{totalFillers}</p>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Duration</p>
                        <p className="font-bold text-lg text-foreground">{durationMins} min</p>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export const AnalyticsDashboardSkeleton = () => (
    <div className="space-y-8 animate-pulse">
        <div className="grid gap-6 md:grid-cols-3">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <Skeleton className="h-5 w-2/5" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-8 w-1/3" />
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <Skeleton className="h-5 w-4/5" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-8 w-1/3" />
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <Skeleton className="h-5 w-3/5" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-8 w-1/3" />
                </CardContent>
            </Card>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            <Card className="col-span-1 lg:col-span-3">
                <CardHeader>
                    <Skeleton className="h-6 w-1/3" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-[240px] w-full" />
                </CardContent>
            </Card>
            <Card className="col-span-1 lg:col-span-2">
                 <CardHeader>
                    <Skeleton className="h-6 w-1/2" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-[240px] w-full" />
                </CardContent>
            </Card>
        </div>

        <Card>
            <CardHeader>
                <Skeleton className="h-6 w-1/4" />
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="space-y-2 text-right">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                </div>
                 <div className="flex justify-between items-center">
                    <div className="space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="space-y-2 text-right">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>
);

export const AnalyticsDashboard = ({ sessionHistory }) => {
    if (!sessionHistory || sessionHistory.length === 0) {
        return <EmptyState />;
    }

    const trends = calculateTrends(sessionHistory);

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                <StatCard icon={<Layers size={24} className="text-muted-foreground" />} label="Total Sessions" value={trends.totalSessions} className="sm:col-span-2 md:col-span-1" />
                <StatCard icon={<TrendingUp size={24} className="text-muted-foreground" />} label="Avg. Filler Words / Min" value={trends.avgFillerWordsPerMin} />
                <StatCard icon={<Clock size={24} className="text-muted-foreground" />} label="Total Practice Time" value={trends.totalPracticeTime} unit="mins" />
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
                <Card className="col-span-1 lg:col-span-3">
                    <CardHeader>
                        <CardTitle>Filler Word Trend</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        {trends.chartData.length > 1 ? (
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={trends.chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={14} tickLine={false} axisLine={false} />
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={14} tickLine={false} axisLine={false} />
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
                        ) : (
                            <div className="flex items-center justify-center h-[300px] text-center text-muted-foreground">
                                <p>Complete at least two sessions to see your progress trend.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="col-span-1 lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Top Filler Words</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {trends.topFillerWords.length > 0 ? (
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={trends.topFillerWords} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={16} tickLine={false} axisLine={false} width={80} />
                                    <Tooltip
                                        cursor={{ fill: 'hsla(var(--secondary))' }}
                                        contentStyle={{
                                            backgroundColor: 'hsl(var(--card))',
                                            borderColor: 'hsl(var(--border))',
                                            color: 'hsl(var(--foreground))'
                                        }}
                                    />
                                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                                        <LabelList dataKey="value" position="right" className="fill-white" />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                                <p>No filler words detected yet. Keep practicing!</p>
                            </div>
                        )}
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
