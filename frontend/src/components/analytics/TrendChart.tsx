import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, type TooltipContentProps } from 'recharts';
import { Card } from '@/components/ui/card';
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import { PRODUCT_LABEL, plural, shortDate, shortTime } from '@/lib/displayFormat';
import { useChartContainerReady } from './useChartContainerReady';
import { metricConfig, measuredPoints, sessionsStillNeeded, type TrendDataPoint, type TrendMetric } from './trendMetrics';

const tooltipValue = (metric: TrendMetric, value: number): string => {
    if (metric === 'wpm') return `${Math.round(value)} words a minute`;
    if (metric === 'clarity') return `${Math.round(value)}%`;
    if (metric === 'pauses') return `${value.toFixed(1)} pauses a minute`;
    return String(value);
};

interface TrendChartProps {
    data: TrendDataPoint[];
    metric: TrendMetric;
    title?: string;
    description?: string;
    /** #1258 D7: inside a Trends row the row is the title — render the chart alone, without the Card. */
    bare?: boolean;
}

export const TrendChart: React.FC<TrendChartProps> = ({ data, metric, title, description, bare = false }) => {
    const chartContainer = useChartContainerReady();
    const config = metricConfig[metric];

    // #G4 §3: pace is the one signal with an explicit "good" band (WPM min–max). Shade that band directly
    // on the trend so the line reads against a target, not just an axis. Derived internally — no other
    // metric carries an equivalent two-sided target, so band support is scoped to WPM.
    const band = metric === 'wpm'
        ? { min: ANALYTICS_THRESHOLDS.TARGET_WPM_MIN, max: ANALYTICS_THRESHOLDS.TARGET_WPM_MAX }
        : null;

    // #1047: sufficiency is per-metric NON-NULL points, not total session count. A provenance-gated metric
    // is null for not_captured/expired sessions, so a history of 5 sessions may carry few real points.
    const values = measuredPoints(data, metric);
    const stillNeeded = sessionsStillNeeded(values.length);

    // #1258 D8: a high clarity series is drawn against a narrowed axis, not 0–100.
    const clarityMin = values.length > 0
        ? Math.max(0, Math.min(100 - 20, Math.floor((Math.min(...values) - 5) / 10) * 10))
        : 0;

    const renderTooltip = ({ active, payload }: TooltipContentProps<number, string>) => {
        const point = payload?.[0]?.payload as TrendDataPoint | undefined;
        const value = payload?.[0]?.value;
        if (!active || !point || typeof value !== 'number') return null;
        const product = point.product ? `${PRODUCT_LABEL[point.product]} · ` : '';
        return (
            <div className="rounded-lg border border-neutral-border-strong bg-white px-3 py-2 shadow-sm">
                <p className="text-[12px] font-bold text-neutral-heading">{product}{shortDate(point.createdAt)}, {shortTime(point.createdAt)}</p>
                <p className="text-[14px] font-semibold text-neutral-body">{tooltipValue(metric, value)}</p>
            </div>
        );
    };

    const chart = (
        <div ref={chartContainer.ref} className={stillNeeded > 0 ? 'w-full' : 'h-[240px] w-full'}>
            {stillNeeded > 0 ? (
                <p className="text-[14px] font-semibold text-neutral-secondary">
                    Appears after {plural(stillNeeded, 'more session', 'more sessions')}
                </p>
            ) : chartContainer.isReady ? (
                <AreaChart width={chartContainer.size.width} height={chartContainer.size.height} data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--brand-neutral-border-soft)" />
                        {/* #G4 §3: target band. ifOverflow="extendDomain" forces the Y axis to include the
                            band even when every session sits above/below it, so the target is always visible. */}
                        {band && (
                            <ReferenceArea
                                y1={band.min}
                                y2={band.max}
                                ifOverflow="extendDomain"
                                fill={config.color}
                                fillOpacity={0.08}
                                strokeOpacity={0}
                                label={{ value: `Target ${band.min}–${band.max}`, position: 'insideTopRight', fontSize: 11, fill: 'var(--brand-neutral-secondary)' }}
                            />
                        )}
                        <XAxis
                            dataKey="i"
                            stroke="var(--brand-neutral-secondary)"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickMargin={10}
                            interval={0}
                            tickFormatter={(i: number) => data[i]?.dayLabel ?? ''}
                        />
                        <YAxis
                            stroke="var(--brand-neutral-secondary)"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            domain={metric === 'clarity' ? [clarityMin, 100] : undefined}
                            tickFormatter={(value) => `${value}${config.unit}`}
                        />
                        <Tooltip content={renderTooltip} />
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
    );

    if (bare) return <div data-testid={`${metric}-trend-chart`}>{chart}</div>;

    return (
        <Card className="rounded-xl p-6" data-testid={`${metric}-trend-chart`}>
            {title && (
                <div className="mb-6">
                    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                    {description && <p className="text-sm font-medium text-foreground/70">{description}</p>}
                </div>
            )}
            {chart}
        </Card>
    );
};
