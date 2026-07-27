import * as React from 'react';
import { BarChart3, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PracticeSession } from '@/types/session';

/**
 * #1042 PR4 — Practice Home continuity block on the authenticated `/practice` chooser.
 *
 * Presentational only (data is fetched in PracticePage via usePracticeHistory). It renders:
 *  - returning user (a most-recent session exists): "Ready for your next practice?" + a TRUTHFUL summary
 *    (only fields actually persisted — date, duration, and WPM when present) + Review-last-session and
 *    View-analytics actions;
 *  - new user (no sessions): a truthful empty state with NO fabricated metrics and no dead actions;
 *  - loading: a neutral placeholder so the block never flashes fabricated data before the query resolves.
 *
 * It never fabricates a metric: a field is shown only when the stored value is present.
 */

function formatDuration(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatWhen(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PracticeContinuity({
    loading,
    lastSession,
    onReviewLast,
    onViewAnalytics,
}: {
    loading: boolean;
    lastSession: PracticeSession | null;
    onReviewLast: () => void;
    onViewAnalytics: () => void;
}) {
    if (loading) {
        return (
            <div
                data-testid="practice-continuity-loading"
                aria-hidden="true"
                className="mb-6 h-16 animate-pulse rounded-xl bg-[color:var(--ss-card-soft)]/60"
            />
        );
    }

    if (!lastSession) {
        // Truthful empty state — no numbers, no dead actions. The chooser's Freestyle card below is the CTA.
        return (
            <section
                data-testid="practice-continuity-empty"
                aria-label="Your practice progress"
                className="mb-6 rounded-xl border border-[color:var(--ss-border)] bg-[color:var(--ss-surface)] px-4 py-3 text-sm text-[color:var(--ss-text-secondary)]"
            >
                No sessions yet — start your first Freestyle Practice below and your progress will appear here.
            </section>
        );
    }

    const when = formatWhen(lastSession.created_at);
    const wpm = typeof lastSession.wpm === 'number' && Number.isFinite(lastSession.wpm) ? Math.round(lastSession.wpm) : null;
    // Compose from persisted fields only; omit any that are absent.
    const parts = [
        when ? `Last session ${when}` : 'Your last session',
        formatDuration(lastSession.duration),
        wpm != null ? `${wpm} WPM` : null,
    ].filter(Boolean);

    return (
        <section
            data-testid="practice-continuity"
            aria-label="Your recent practice"
            className="mb-6 rounded-xl border border-[color:var(--ss-border)] bg-[color:var(--ss-surface)] px-4 py-4 shadow-sm"
        >
            <h2 className="text-lg font-bold tracking-tight text-[color:var(--ss-text)]">Ready for your next practice?</h2>
            <p className="mt-1 text-sm text-[color:var(--ss-text-secondary)]" data-testid="practice-continuity-summary">
                {parts.join(' · ')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="inline-flex items-center gap-1.5"
                    onClick={onReviewLast}
                    data-testid="practice-continuity-review"
                >
                    <FileText size={15} aria-hidden /> Review last session
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="inline-flex items-center gap-1.5"
                    onClick={onViewAnalytics}
                    data-testid="practice-continuity-analytics"
                >
                    <BarChart3 size={15} aria-hidden /> View analytics
                </Button>
            </div>
        </section>
    );
}
