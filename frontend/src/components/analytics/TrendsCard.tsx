/**
 * #1258 D7 — Trends on Progress: one card, one row per selected analysis tool, EVERY row collapsed on mount (not
 * persisted). A row shows its colour, title and a one-line summary; its chart is mounted only while the row is open,
 * so closed charts cost nothing.
 */
import React, { useMemo, useState } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { plural } from '@/lib/displayFormat';
import type { PracticeSession } from '@/types/session';
import { TrendChart } from './TrendChart';
import { metricConfig, type TrendDataPoint } from './trendMetrics';
import { trendSummary } from './trendSummary';
import { FillerWordsBreakdown } from './FillerWordsBreakdown';
import { fillerBreakdownModel, fillerSummary } from './fillerBreakdown';
import { WeeklyActivityChart } from './WeeklyActivityChart';

interface TrendRow { id: string; title: string; color: string; summary: React.ReactNode; body: React.ReactNode }

const WeeklySummary: React.FC = () => {
    const { weeklyActivity } = useAnalytics();
    const n = (weeklyActivity ?? []).reduce((sum, d) => sum + (d.sessions || 0), 0);
    return <>{plural(n, 'session', 'sessions')} this week</>;
};

interface TrendsCardProps {
    /** The selected focus's analysis tools, in order (`displayedAnalysisSlides`). */
    slideIds: string[];
    trendData: TrendDataPoint[];
    /** Newest first. */
    sessions: PracticeSession[];
    /** Custom focus only: the existing analysis-tool picker, kept beside the heading. */
    headerAction?: React.ReactNode;
}

export const TrendsCard: React.FC<TrendsCardProps> = ({ slideIds, trendData, sessions, headerAction }) => {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
    // The counting tier's default (true fillers), the same reading the session page shows.
    const fillerModel = useMemo(() => fillerBreakdownModel(sessions), [sessions]);

    const rows = slideIds.flatMap((id): TrendRow[] => {
        switch (id) {
            case 'pace_trend':
                return [{ id, title: 'Speaking pace', color: metricConfig.wpm.color, summary: trendSummary('wpm', trendData), body: <TrendChart metric="wpm" data={trendData} bare /> }];
            case 'pause_trend':
                return [{ id, title: 'Pause rhythm', color: metricConfig.pauses.color, summary: trendSummary('pauses', trendData), body: <TrendChart metric="pauses" data={trendData} bare /> }];
            case 'clarity_trend':
                return [{ id, title: 'Clear delivery', color: metricConfig.clarity.color, summary: trendSummary('clarity', trendData), body: <TrendChart metric="clarity" data={trendData} bare /> }];
            case 'filler_words':
                return [{ id, title: 'Filler words', color: metricConfig.fillers.color, summary: fillerSummary(fillerModel), body: <FillerWordsBreakdown model={fillerModel} /> }];
            case 'weekly_activity':
                return [{ id, title: 'Weekly activity', color: 'var(--brand-neutral-muted)', summary: <WeeklySummary />, body: <WeeklyActivityChart /> }];
            default:
                return [];
        }
    });

    return (
        <section aria-labelledby="trends-h" className="space-y-3" data-testid="trends-card">
            <div className="flex items-center justify-between gap-3">
                <h2 id="trends-h" className="text-[20px] font-extrabold text-neutral-heading">Trends</h2>
                {headerAction}
            </div>
            <div className="overflow-hidden rounded-[14px] border border-neutral-border-strong bg-white">
                {rows.map((row, i) => {
                    const isOpen = Boolean(open[row.id]);
                    return (
                        <div key={row.id} className={i ? 'border-t border-neutral-border-soft' : ''}>
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-controls={`trend-${row.id}`}
                                onClick={() => toggle(row.id)}
                                data-testid={`trend-row-${row.id}`}
                                className="flex min-h-14 w-full items-center gap-3 px-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                                <span className="text-[16px] font-extrabold text-neutral-heading">{row.title}</span>
                                <span className="ml-auto text-right text-[14px] font-bold text-neutral-secondary">{row.summary}</span>
                                <span aria-hidden className="w-6 shrink-0 text-center text-[20px] font-bold text-neutral-secondary">{isOpen ? '−' : '+'}</span>
                            </button>
                            <div id={`trend-${row.id}`} hidden={!isOpen} className="px-5 pb-5 pt-1">{isOpen && row.body}</div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
