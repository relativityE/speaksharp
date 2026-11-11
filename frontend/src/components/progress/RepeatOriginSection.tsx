import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadRepeatOrigin } from '@/services/progress/loadRepeatOrigin';
import { formatOriginalSessionLabel, formatRepeatValues, reviewOwnedOutcome, TARGET_METRIC_LABELS } from './repeatOutcomeCopy';

/**
 * Outcome 4, first increment: on a repeat's Progress page, say which session it repeated (linked) and what the stored
 * comparison found, in the same words Progress uses on the original session. It states stored values and the server's
 * derived outcome only — never that the tip was followed, a target reached, or that anything improved because of it.
 *
 * Renders nothing while loading and for any session that is not a linked repeat. A failed read is never presented as
 * "not a repeat": it says the link could not be checked and offers a retry.
 */
export const RepeatOriginSection: React.FC<{ sessionId: string }> = ({ sessionId }) => {
    const { user } = useAuthProvider();
    const userId = user?.id ?? null;
    const query = useQuery({
        queryKey: ['repeatOrigin', sessionId, userId],
        queryFn: () => loadRepeatOrigin(sessionId, userId as string),
        enabled: !!sessionId && !!userId,
        staleTime: 60 * 1000,
    });

    if (!userId || query.isPending) return null;
    const view = query.data;
    if (query.isError || !view || view.status === 'error') return (
        <div data-testid="repeat-origin-error" role="alert" className="flex flex-wrap items-center gap-2 text-sm text-foreground/80">
            <span>Whether this session repeats an earlier one could not be checked.</span>
            <Button type="button" variant="outline" size="sm" data-testid="repeat-origin-retry" onClick={() => { void query.refetch(); }}>Retry</Button>
        </div>
    );
    if (view.status !== 'repeat') return null;

    const label = formatOriginalSessionLabel(view.originalCreatedAt);
    const metric = TARGET_METRIC_LABELS[view.target.metric];
    const result = view.repeatResult;
    return (
        <section data-testid="repeat-origin" aria-label="Repeat of an earlier session" className="rounded-xl border border-primary/20 bg-background p-4 space-y-1">
            <p className="text-sm font-semibold text-foreground">
                <Link data-testid="repeat-origin-link" to={`/progress/${encodeURIComponent(view.originalSessionId)}`} className="text-signature underline">
                    {label ? `Repeat of your ${label} session` : 'Repeat of your earlier session'}
                </Link>
            </p>
            {view.lifecycle === 'not_comparable' && (
                <p data-testid="repeat-origin-outcome" className="text-sm text-foreground/80">
                    {reviewOwnedOutcome(view.target, view.lifecycle, view.outcome)}
                </p>
            )}
            {view.lifecycle === 'completed' && result?.status !== 'available' && (
                <p data-testid="repeat-origin-values" className="text-sm text-foreground/80">
                    The original and repeat values for this comparison are not available.
                </p>
            )}
            {view.lifecycle === 'completed' && result?.status === 'available' && (() => {
                const { before, after, belowPrecision } = formatRepeatValues(result.metric, result.before, result.after);
                return <>
                    <p data-testid="repeat-origin-values" className="text-sm text-foreground/80">
                        {metric}: {before} → {after} {result.units} (original session → this repeat).
                        {belowPrecision && ' The stored values differ by less than the displayed precision.'}
                    </p>
                    <p data-testid="repeat-origin-outcome" className="text-sm text-foreground/80">
                        {reviewOwnedOutcome(view.target, view.lifecycle, view.outcome)}
                    </p>
                    <p data-testid="repeat-origin-scope" className="text-xs text-foreground/70">
                        This comparison measures delivery, not whether the coaching tip was followed.
                    </p>
                </>;
            })()}
        </section>
    );
};

export default RepeatOriginSection;
