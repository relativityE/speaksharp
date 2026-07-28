import * as React from 'react';
import { BarChart3, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PracticeSession } from '@/types/session';

/** The NARROW shape the continuity card needs — only reviewable-history identity + duration. */
export type RecentSession = Pick<PracticeSession, 'id' | 'created_at' | 'duration' | 'status'>;

/**
 * #1042 PR4 — Practice Home continuity block on the authenticated `/practice` chooser.
 *
 * Presentational only (data is fetched in PracticePage via useRecentPracticeSummary — a narrow read of
 * id/created_at/duration/status). It renders:
 *  - returning user (a most-recent reviewable session exists): "Ready for your next practice?" + a TRUTHFUL
 *    summary (date + duration only — duration omitted when absent) + Review-last-session and View-analytics;
 *  - new user (no sessions): "Start your first practice" + the approved reassurance copy;
 *  - error (the read FAILED): an honest error state — never the false "no sessions" empty state;
 *  - loading: a neutral placeholder so the block never flashes fabricated data.
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
    error = false,
    lastSession,
    onReviewLast,
    onViewAnalytics,
    variant = 'block',
}: {
    loading: boolean;
    /** True when the history query FAILED — must NOT be shown as the empty "no sessions" state. */
    error?: boolean;
    lastSession: RecentSession | null;
    onReviewLast: () => void;
    onViewAnalytics: () => void;
    /** #1061: 'inline' renders the compact greeting-row cluster (no "Ready for your next practice?" heading,
     *  right-aligned) used in the authenticated header; 'block' is the original standalone card. */
    variant?: 'block' | 'inline';
}) {
    const inline = variant === 'inline';
    if (loading) {
        return (
            <div
                data-testid="practice-continuity-loading"
                aria-hidden="true"
                className="mb-6 h-16 animate-pulse rounded-xl bg-[color:var(--ss-card-soft)]/60"
            />
        );
    }

    // A failed load must NOT masquerade as "no sessions yet". Say so honestly and keep the user moving —
    // without claiming anything about the data we could not read.
    if (error) {
        return (
            <section
                data-testid="practice-continuity-error"
                role="status"
                aria-label="Your practice progress"
                className="mb-6 rounded-xl border border-[color:var(--ss-border)] bg-[color:var(--ss-surface)] px-4 py-3 text-sm text-[color:var(--ss-text-secondary)]"
            >
                We couldn’t load your recent practice. You can still start Freestyle Practice below.
            </section>
        );
    }

    if (!lastSession) {
        // Truthful empty state — the approved new-user heading + reassurance, no numbers, no dead actions.
        return (
            <section
                data-testid="practice-continuity-empty"
                aria-label="Your practice progress"
                className="mb-6 rounded-xl border border-[color:var(--ss-border)] bg-[color:var(--ss-surface)] px-4 py-4"
            >
                <h2 className="text-lg font-bold tracking-tight text-[color:var(--ss-text)]">Start your first practice</h2>
                <p className="mt-1 text-sm text-[color:var(--ss-text-secondary)]">
                    Your completed sessions and progress will appear here after you finish.
                </p>
            </section>
        );
    }

    const when = formatWhen(lastSession.created_at);
    // duration is a nullable DB column; omit it when absent instead of showing a fabricated 0:00.
    const durationText = typeof lastSession.duration === 'number' && Number.isFinite(lastSession.duration) && lastSession.duration > 0
        ? formatDuration(lastSession.duration)
        : null;
    // Composed from persisted fields only (date + duration); duration omitted when absent.
    const parts = [
        when ? `Last practice ${when}` : 'Last practice',
        durationText,
    ].filter(Boolean);

    const actions = (
        <>
            <Button type="button" variant="outline" size="sm" className="inline-flex items-center gap-1.5" onClick={onReviewLast} data-testid="practice-continuity-review">
                <FileText size={15} aria-hidden /> Review last session
            </Button>
            <Button type="button" variant="ghost" size="sm" className="inline-flex items-center gap-1.5" onClick={onViewAnalytics} data-testid="practice-continuity-analytics">
                <BarChart3 size={15} aria-hidden /> View analytics
            </Button>
        </>
    );

    if (inline) {
        // Compact greeting-row cluster: label + date/duration, then the two actions (right-aligned on md+).
        return (
            <div data-testid="practice-continuity" aria-label="Your recent practice" className="flex flex-col gap-2 sm:items-end">
                <p className="text-sm text-[color:var(--ss-text-secondary)]" data-testid="practice-continuity-summary">{parts.join(' · ')}</p>
                <div className="flex flex-wrap items-center gap-2">{actions}</div>
            </div>
        );
    }

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
            <div className="mt-3 flex flex-wrap items-center gap-3">{actions}</div>
        </section>
    );
}
