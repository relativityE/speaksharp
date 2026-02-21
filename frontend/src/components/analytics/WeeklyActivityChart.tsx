import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const WeeklyActivityChart: React.FC = () => {
    const { sessionHistory, loading, error } = useAnalytics();

    // Calculate weekly activity from real session data
    const chartData = useMemo(() => {
        // Initialize all days with 0 sessions
        const dayCounts: Record<string, number> = {};
        DAYS_OF_WEEK.forEach(day => { dayCounts[day] = 0; });

        // Get the start of the current week (Sunday)
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        // Count sessions per day for the current week
        sessionHistory?.forEach(session => {
            const sessionDate = new Date(session.created_at);
            // Only count sessions from the current week
            if (sessionDate >= startOfWeek) {
                const dayName = DAYS_OF_WEEK[sessionDate.getDay()];
                dayCounts[dayName]++;
            }
        });

        // Convert to array format for recharts, starting with Mon for display
        const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return orderedDays.map(day => ({
            day,
            sessions: dayCounts[day]
        }));
    }, [sessionHistory]);

    if (loading) {
        return (
            <Card className="h-full">
                <CardHeader><CardTitle>Weekly Activity</CardTitle></CardHeader>
                <CardContent>
                    <Skeleton className="h-[250px] w-full" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="h-full">
                <CardHeader><CardTitle>Weekly Activity</CardTitle></CardHeader>
                <CardContent>
                    <p className="text-destructive">Could not load activity data.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="h-full glass p-8 rounded-[2rem] shadow-sm">
            <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold text-foreground">Weekly Activity</h3>
            </div>
            <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <defs>
                            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity={1} />
                                <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity={0.8} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                        <XAxis
                            dataKey="day"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={10}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip
                            cursor={{ fill: 'rgba(255,255,255,0.05)', radius: 8 }}
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                borderColor: 'hsl(var(--border))',
                                color: 'hsl(var(--popover-foreground))',
                                borderRadius: '12px',
                                border: '1px solid hsl(var(--border))',
                                boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                            }}
                        />
                        <Bar
                            dataKey="sessions"
                            fill="url(#barGradient)"
                            radius={[6, 6, 2, 2]}
                            barSize={32}
                            activeBar={{ opacity: 0.9 }}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
