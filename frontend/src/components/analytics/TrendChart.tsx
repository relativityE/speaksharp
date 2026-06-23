import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import { useChartContainerReady } from './useChartContainerReady';

interface TrendDataPoint {
    date: string;
    wpm: number;
    clarity: number;
    fillers: number;
    pauses: number;
}

interface TrendChartProps {
    data: TrendDataPoint[];
    metric: 'wpm' | 'clarity' | 'fillers' | 'pauses';
    title: string;
    description?: string;
}

export const TrendChart: React.FC<TrendChartProps> = ({ data, metric, title, description }) => {
    const chartContainer = useChartContainerReady();
    const metricConfig = {
        wpm: { color: 'hsl(var(--primary))', label: `WPM (Target: ${ANALYTICS_THRESHOLDS.TARGET_WPM_MIN}-${ANALYTICS_THRESHOLDS.TARGET_WPM_MAX})`, unit: '' },
        clarity: { color: 'hsl(var(--chart-2))', label: 'Clarity', unit: '%' },
        fillers: { color: 'hsl(var(--secondary))', label: 'Fillers', unit: '' },
        pauses: { color: 'hsl(var(--chart-4))', label: 'Pause Rhythm', unit: '/min' },
    };

    const config = metricConfig[metric];

    return (
        <Card className="rounded-xl p-6" data-testid={`${metric}-trend-chart`}>
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                {description && <p className="text-sm font-medium text-foreground/70">{description}</p>}
            </div>

            <div ref={chartContainer.ref} className="h-[240px] w-full">
                {data.length < 2 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border-strong))] bg-muted/70 px-6 text-center text-foreground/75">
                        <p className="font-bold text-foreground">Not enough data yet</p>
                        <p className="text-sm font-medium">Complete at least 2 sessions to see your {config.label.toLowerCase()} trend.</p>
                    </div>
                ) : chartContainer.isReady ? (
                    <AreaChart width={chartContainer.size.width} height={chartContainer.size.height} data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
                ) : (
                    <div className="h-full w-full rounded-xl bg-muted/60" aria-hidden="true" />
                )}
            </div>
        </Card>
    );
};
