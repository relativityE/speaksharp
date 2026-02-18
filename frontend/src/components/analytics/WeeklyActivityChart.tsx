import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const WeeklyActivityChart: React.FC = () => {
    const { weeklyActivity, loading, error } = useAnalytics();

    // Use pre-computed chart data from useAnalytics (which handles RPC or fallback)
    const chartData = useMemo(() => {
        if (!weeklyActivity || weeklyActivity.length === 0) return [];

        // Convert to array format for recharts, starting with Mon for display
        // weeklyActivity from RPC/hook uses standard ['Sun', ..., 'Sat'] order
        const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return orderedDays.map(day => {
            const dayData = weeklyActivity.find(d => d.day === day);
            return {
                day,
                sessions: dayData ? dayData.sessions : 0
            };
        });
    }, [weeklyActivity]);

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
        <Card className="h-full bg-card border-border p-6 rounded-xl shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Weekly Activity</h3>
            </div>
            <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
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
                            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
                            contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                borderColor: 'hsl(var(--border))',
                                color: 'hsl(var(--popover-foreground))',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                            }}
                        />
                        <Bar
                            dataKey="sessions"
                            fill="hsl(var(--primary))"
                            radius={[6, 6, 0, 0]}
                            barSize={32}
                            activeBar={{ fill: 'hsl(var(--primary))', opacity: 0.8 }}
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    );
};
