import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { PracticeSession } from '@/types/session';
import { PRACTICE_THIS_NEXT_LABEL } from '@/services/progress/progressPresentation';
import { abandonRecommendationAttempt } from '@/services/progress/recordProgress';
import { useLinkedRepeat } from '@/hooks/useLinkedRepeat';
import { clearOpenAttemptIfMatches } from '@/services/progress/openAttempt';
import type { ExclusionReason } from '@/services/progress/buildProgressEvaluation';

const REASON_LABELS: Record<ExclusionReason, string> = {
    not_completed: 'This session was not completed, so it cannot be compared.',
    too_short: 'This session was too short for a reliable comparison.',
    too_few_words: 'This session needs more spoken words for a reliable comparison.',
    no_transcript: 'No transcript was available for this session.',
    no_clarity_evidence: 'Clear-delivery evidence was not available for this session.',
    unverified_attribution: 'The recording evidence could not be verified.',
    engine_not_comparable: 'This recording setup cannot be compared with the earlier setup.',
    unknown: 'This session did not meet the comparison evidence requirements.',
};

/**
 * `nextActionOwnedByReview` (#1258 G20, PM 2026-09-25): when the saved review at the top of the page shows, it owns
 * the page's ONE next action. The panel then keeps its metrics and evidence but drops its competing "Practice this
 * next" sentence and button (and the practice buttons of its no-comparison states). The linked repeat itself is not
 * lost: the review's button runs the same `useLinkedRepeat`.
 */
export const ProgressPanel: React.FC<{ session: Pick<PracticeSession, 'id'>; nextActionOwnedByReview?: boolean }> = ({ session, nextActionOwnedByReview = false }) => {
    const navigate = useNavigate();
    const [reconcilingPending, setReconcilingPending] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const retryRef = useRef<HTMLButtonElement>(null);
    const { query, view, userId, accept, accepting, actionError, setActionError, retryBlocked, setRetryBlocked } = useLinkedRepeat(session.id);

    useEffect(() => {
        if (query.isSuccess && query.data?.status !== 'error') headingRef.current?.focus();
    }, [query.isSuccess, query.data]);
    useEffect(() => { if (actionError) retryRef.current?.focus(); }, [actionError]);

    const onAccept = () => accept(() => navigate('/session'));

    const onReconcilePending = async (attemptId: string) => {
        if (reconcilingPending) return;
        setReconcilingPending(true);
        setActionError(null);
        const abandoned = await abandonRecommendationAttempt(attemptId);
        if (abandoned) {
            const locallyCleared = !!userId && clearOpenAttemptIfMatches(userId, attemptId);
            if (locallyCleared) {
                await query.refetch();
            } else {
                setRetryBlocked(true);
                setActionError('The repeat was closed on the server, but its local handoff could not be cleared. New attempts remain blocked until cleanup succeeds.');
            }
        } else {
            setRetryBlocked(true);
            setActionError('The pending repeat could not be safely closed. New attempts remain blocked.');
        }
        setReconcilingPending(false);
    };

    const shell = (content: React.ReactNode) => (
        <section data-testid="progress-panel" aria-labelledby="progress-heading" className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <h2 id="progress-heading" ref={headingRef} tabIndex={-1} className="text-xs font-bold uppercase tracking-wide text-foreground">Your progress</h2>
            <div aria-live="polite" aria-atomic="true">{content}</div>
        </section>
    );

    if (query.isLoading) return shell(<p data-testid="progress-loading">Loading progress…</p>);
    if (query.isError || view?.status === 'error' || view?.status === 'unavailable') return shell(
        <div role="alert" className="space-y-3">
            <p>{view?.status === 'error' || view?.status === 'unavailable' ? view.message : 'Progress could not be loaded.'}</p>
            <Button type="button" onClick={() => { void query.refetch(); }}>Retry</Button>
        </div>,
    );
    if (!view || view.status === 'insufficient') return shell(
        <div className="space-y-3"><p>More evidence is needed before a reliable comparison is available.</p>{!nextActionOwnedByReview && <Button type="button" onClick={() => { navigate('/session'); }}>Practice again</Button>}</div>,
    );
    if (view.status === 'ineligible') return shell(
        <div className="space-y-2">
            <p>Comparison is unavailable for this session.</p>
            <ul className="list-disc pl-5">{view.reasons.map((reason) => <li key={reason}>{REASON_LABELS[reason]}</li>)}</ul>
            {!nextActionOwnedByReview && <Button type="button" onClick={() => { navigate('/session'); }}>Collect more evidence</Button>}
        </div>,
    );

    const outcome = view.latestAttempt?.outcome;
    const pendingAttemptId = view.latestAttempt?.lifecycle === 'pending' ? view.latestAttempt.id : null;
    return shell(<>
        {!nextActionOwnedByReview && <div className="rounded-lg border border-primary/25 bg-background p-4" data-testid="progress-practice-next">
            <p className="text-xs font-bold uppercase tracking-wide text-foreground">{PRACTICE_THIS_NEXT_LABEL}</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{view.takeaways.practiceThisNext}</p>
            {!pendingAttemptId && !actionError && (
                <Button className="mt-3" type="button" onClick={() => { void onAccept(); }} disabled={accepting || !view.recommendationId} data-testid="progress-accept">
                    {accepting ? 'Linking repeat…' : PRACTICE_THIS_NEXT_LABEL}
                </Button>
            )}
        </div>}
        <div className="space-y-1" aria-label="Supporting comparison evidence">
            <p className="text-sm text-foreground/80" data-testid="progress-direction">{view.direction.text}</p>
            <p className="text-xs text-foreground/80" data-testid="progress-baseline-context">{view.baselineContext}</p>
            {view.disclosure && (
                <details className="text-xs text-foreground/70" data-testid="progress-disclosure">
                    <summary className="cursor-pointer text-foreground/80">How this was measured</summary>
                    <dl className="mt-1 space-y-0.5">
                        <div><dt className="inline font-semibold">Compared with:</dt>{' '}
                            <dd className="inline" data-testid="progress-disclosure-reference">{view.disclosure.referenceRole} (session {view.disclosure.referenceSessionId}){view.disclosure.alsoFirstComparable ? ', also your first-session baseline' : ''}</dd></div>
                        <div><dt className="inline font-semibold">Recording cohort:</dt>{' '}
                            <dd className="inline" data-testid="progress-disclosure-cohort">{view.disclosure.cohortKey}</dd></div>
                        <div><dt className="inline font-semibold">Inputs:</dt>{' '}
                            <dd className="inline" data-testid="progress-disclosure-inputs">this session {view.disclosure.currentClarityPoints} vs {view.disclosure.referenceClarityPoints} {view.disclosure.units} ({view.disclosure.deltaPoints >= 0 ? '+' : ''}{view.disclosure.deltaPoints} {view.disclosure.units}{view.disclosure.deltaPercent !== null ? `, ${view.disclosure.deltaPercent >= 0 ? '+' : ''}${(Math.round(view.disclosure.deltaPercent * 10) / 10).toFixed(1)}%` : ', no defensible percentage'})</dd></div>
                    </dl>
                </details>
            )}
        </div>
        <dl>
            <div data-testid="progress-what-worked"><dt className="text-xs font-semibold uppercase tracking-wide text-foreground">Evidence-backed observation</dt><dd className="mt-0.5 text-sm text-foreground/80">{view.takeaways.whatWorked}</dd></div>
        </dl>
        {view.latestAttempt && <p data-testid="progress-attempt-outcome" className="text-sm text-foreground/80">{
            view.latestAttempt.lifecycle === 'pending' ? 'Your linked repeat is pending.'
                : outcome === 'moved' ? 'The stored repeat shows movement in the practiced direction.'
                    : outcome === 'did_not_move' ? 'The stored repeat did not show movement in the practiced direction.'
                        : outcome === 'not_comparable' ? 'The stored repeat was not comparable.'
                            : 'The stored repeat was not completed.'
        }</p>}
        {actionError && <div role="alert" className="space-y-2"><p>{actionError}</p>{!retryBlocked && <Button ref={retryRef} type="button" onClick={() => { void onAccept(); }}>Retry {PRACTICE_THIS_NEXT_LABEL}</Button>}</div>}
        {pendingAttemptId && <div role="alert" className="space-y-2">
            <p>A previous repeat is still pending. Close it before starting another.</p>
            <Button type="button" disabled={reconcilingPending} onClick={() => { void onReconcilePending(pendingAttemptId); }}>
                {reconcilingPending ? 'Closing pending repeat…' : 'Close pending repeat'}
            </Button>
        </div>}
    </>);
};

export default ProgressPanel;
