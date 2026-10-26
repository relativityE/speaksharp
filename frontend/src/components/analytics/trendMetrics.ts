/**
 * #1258 D7/D8 — the trend data contract shared by the chart, the Trends row summaries and the dashboard. Kept out of the
 * component files so they export components only.
 */
import type { SessionProduct } from '@/types/session';

export type TrendMetric = 'wpm' | 'clarity' | 'fillers' | 'pauses';

export interface TrendDataPoint {
    /** Position on the x-axis (oldest first). The axis is keyed by index so two sessions on one day stay two points. */
    i: number;
    /** #1258 D8: `shortDate` for the first session of each calendar day, '' for the rest — one date label per day. */
    dayLabel: string;
    createdAt: string;
    product: SessionProduct | null;
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
    /** #1258 D8: `null` = no valid pause evidence (`hasValidPauseEvidence`). Left out, never plotted as 0. */
    pauses: number | null;
}

/** #1480 metric palette: a metric keeps one colour everywhere. Pause rhythm is a pace signal, so it shares pace. */
export const metricConfig = {
    wpm: { color: 'var(--brand-ink-hairline)', unit: '' },
    clarity: { color: 'var(--brand-metric-clarity)', unit: '%' },
    fillers: { color: 'var(--brand-signature)', unit: '' },
    pauses: { color: 'var(--brand-ink-hairline)', unit: '/min' },
} as const;

/** #1258 D8: a trend needs three measured sessions before it is drawn. */
export const TREND_MIN_POINTS = 3;

export const measuredPoints = (data: TrendDataPoint[], metric: TrendMetric): number[] =>
    data.map((d) => d[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** `Appears after 2 more sessions` / `Appears after 1 more session`. */
export const sessionsStillNeeded = (measured: number): number => Math.max(0, TREND_MIN_POINTS - measured);
