import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea } from 'recharts';
import { Card } from '@/components/ui/card';
import { ANALYTICS_THRESHOLDS } from '@/utils/sessionAnalysis';
import { useChartContainerReady } from './useChartContainerReady';

// #G4 §3: trend x-axis tick labels come through as the app's long date ("August 10, 2026"), which crowd
// and overlap. Collapse each tick to a compact "Aug 10". Falls back to the raw label if it won't parse.
function shortenTrendDate(label: string): string {
    if (!label) return '';
    const d = new Date(label);
    if (isNaN(d.getTime())) return label;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TrendDataPoint {
    date: string;
    // #1047: `null` = this session's transcript-state provenance says the metric is not measured
    // (not_captured / expired-without-persisted). A null point is omitted from the trend (never a
    // fabricated zero), matching the corrected clarity gating below.
    wpm: number | null;
    /**
     * #1091: `null` = this session carries no scorable clarity evidence. An unscorable session's
     * `clarityScore` is 0 BY DESIGN, so plotting it drew a fabricated zero on the trend line — the same
     * evidence-integrity defect fixed in the aggregate and in the server chart series. `<Area>` leaves
     * `connectNulls` at its default `false`, so a null renders as a GAP rather than a point.
     */
    clarity: number | null;
    fillers: number | null;
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

    // #G4 §3: pace is the one signal with an explicit "good" band (WPM min–max). Shade that band directly
    // on the trend so the line reads against a target, not just an axis. Derived internally — no other
    // metric carries an equivalent two-sided target, so band support is scoped to WPM.
    const band = metric === 'wpm'
        ? { min: ANALYTICS_THRESHOLDS.TARGET_WPM_MIN, max: ANALYTICS_THRESHOLDS.TARGET_WPM_MAX }
        : null;

    // #1047: sufficiency is per-metric NON-NULL points, not total session count. A provenance-gated metric
    // is null for not_captured/expired sessions, so a history of 5 sessions may carry <2 real WPM points —
    // charting that would draw a misleading near-empty trend. Require ≥2 genuine (non-null) points.
    const nonNullPoints = data.filter((d) => d[metric] != null).length;
    const insufficient = nonNullPoints < 2;

    return (
        <Card className="rounded-xl p-6" data-testid={`${metric}-trend-chart`}>
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                {description && <p className="text-sm font-medium text-foreground/70">{description}</p>}
            </div>

            <div ref={chartContainer.ref} className="h-[240px] w-full">
                {insufficient ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border-strong))] bg-muted/70 px-6 text-center text-foreground/75">
                        <p className="font-bold text-foreground">Not enough data yet</p>
                        <p className="text-sm font-medium">Complete at least 2 sessions to see your {config.label.toLowerCase()} trend.</p>
                    </div>
                ) : chartContainer.isReady ? (
                    <AreaChart width={chartContainer.size.width} height={chartContainer.size.height} data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
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
                                    label={{ value: `Target ${band.min}–${band.max}`, position: 'insideTopRight', fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                                />
                            )}
                            <XAxis
                                dataKey="date"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickMargin={10}
                                minTickGap={16}
                                tickFormatter={shortenTrendDate}
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
