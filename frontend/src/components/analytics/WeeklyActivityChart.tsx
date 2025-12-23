import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const MOCK_DATA = [
    { day: 'Mon', sessions: 2 },
    { day: 'Tue', sessions: 4 },
    { day: 'Wed', sessions: 1 },
    { day: 'Thu', sessions: 3 },
    { day: 'Fri', sessions: 5 },
    { day: 'Sat', sessions: 2 },
    { day: 'Sun', sessions: 0 },
];

import { useAnalytics } from '@/hooks/useAnalytics';
import { Skeleton } from '@/components/ui/skeleton';

export const WeeklyActivityChart: React.FC = () => {
    const { loading, error } = useAnalytics(); // In a real app, this would fetch activity data

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
        <Card className="h-full">
            <CardHeader>
                <CardTitle>Weekly Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={MOCK_DATA}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.2} />
                            <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip
                                cursor={{ fill: 'hsla(var(--secondary))', opacity: 0.2 }}
                                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                            />
                            <Bar dataKey="sessions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};
