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
        <div className="glass p-8 rounded-[2rem] shadow-sm" data-testid={`${metric}-trend-chart`}>
            <div className="mb-8">
                <h3 className="text-xl font-bold text-foreground">{title}</h3>
                {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            </div>

            <div className="h-[300px] w-full">
                {data.length < 2 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground glass rounded-2xl border-dashed">
                        <p className="font-bold">Not enough data yet</p>
                        <p className="text-sm mt-1">Complete at least 2 sessions to see your {config.label.toLowerCase()} trend.</p>
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
                                    borderRadius: '12px',
                                    border: '1px solid hsl(var(--border))',
                                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                                }}
                            />
                            <defs>
                                <linearGradient id={`color-${metric}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={config.color} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={config.color} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <Area
                                type="monotone"
                                dataKey={metric}
                                stroke={config.color}
                                fill={`url(#color-${metric})`}
                                strokeWidth={3}
                                dot={false}
                                activeDot={{ r: 6, strokeWidth: 0, fill: config.color }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};
