/**
 * #1258 D7/D8 — the one-line value a collapsed Trends row shows. It reads the SAME filtered points the chart draws
 * (`measuredPoints`), so the summary, the "after k more sessions" count and the chart can never disagree.
 */
import { plural } from '@/lib/displayFormat';
import { measuredPoints, sessionsStillNeeded, type TrendDataPoint, type TrendMetric } from './trendMetrics';

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

export function trendSummary(metric: Exclude<TrendMetric, 'fillers'>, data: TrendDataPoint[]): string {
    const values = measuredPoints(data, metric);
    const stillNeeded = sessionsStillNeeded(values.length);
    if (stillNeeded > 0) return `After ${plural(stillNeeded, 'more session', 'more sessions')}`;
    if (metric === 'wpm') return `Avg ${Math.round(mean(values))} wpm`;
    if (metric === 'pauses') return `Avg ${mean(values).toFixed(1)} / min`;
    const rounded = values.map(Math.round);
    const low = Math.min(...rounded);
    const high = Math.max(...rounded);
    if (high - low >= 3) return `Avg ${Math.round(mean(values))}%`;
    return low === high ? `Steady at ${low}%` : `Steady at ${low}–${high}%`;
}
