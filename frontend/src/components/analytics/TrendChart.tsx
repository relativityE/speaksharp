import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TrendDataPoint {
    date: string;
    wpm: number;
    clarity: number;
    fillers: number;
}

interface TrendChartProps {
    data: TrendDataPoint[];
    metric: 'wpm' | 'clarity' | 'fillers';
    title: string;
    description?: string;
}

export const TrendChart: React.FC<TrendChartProps> = ({ data, metric, title, description }) => {
    const metricConfig = {
        wpm: { color: '#3b82f6', label: 'WPM', unit: '' },
        clarity: { color: '#10b981', label: 'Clarity', unit: '%' },
        fillers: { color: '#ef4444', label: 'Fillers', unit: '' },
    };

    const config = metricConfig[metric];

    return (
        <Card data-testid={`${metric}-trend-chart`}>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                            dataKey="date"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <YAxis
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px'
                            }}
                        />
                        <Legend />
                        <Line
                            type="monotone"
                            dataKey={metric}
                            stroke={config.color}
                            strokeWidth={2}
                            name={`${config.label}${config.unit}`}
                            dot={{ fill: config.color, r: 4 }}
                            activeDot={{ r: 6 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};
