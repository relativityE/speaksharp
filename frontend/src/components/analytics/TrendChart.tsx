import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';

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
        wpm: { color: 'hsl(var(--primary))', label: 'WPM (Target: 130-150)', unit: '' },
        clarity: { color: 'hsl(var(--chart-2))', label: 'Clarity', unit: '%' },
        fillers: { color: 'hsl(var(--secondary))', label: 'Fillers', unit: '' },
    };

    const config = metricConfig[metric];

    return (
        <Card className="bg-card border-border p-6 rounded-xl shadow-sm" data-testid={`${metric}-trend-chart`}>
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>

            <div className="h-[300px] w-full">
                {data.length < 2 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                        <p className="font-medium">Not enough data yet</p>
                        <p className="text-sm">Complete at least 2 sessions to see your {config.label.toLowerCase()} trend.</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                            <XAxis
                                dataKey="date"
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
                                tickFormatter={(value) => `${value}${config.unit}`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--popover))',
                                    borderColor: 'hsl(var(--border))',
                                    color: 'hsl(var(--popover-foreground))',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                                }}
                            />
                            <Area
                                type="monotone"
                                dataKey={metric}
                                stroke={config.color}
                                fill={`url(#color-${metric})`}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </Card>
    );
};
