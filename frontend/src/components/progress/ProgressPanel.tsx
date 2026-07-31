import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { PracticeSession } from '@/types/session';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import { PRACTICE_THIS_NEXT_LABEL } from '@/services/progress/progressPresentation';
import { recordRecommendationAttempt } from '@/services/progress/recordProgress';
import { setOpenAttempt } from '@/services/progress/openAttempt';
import logger from '@/lib/logger';

/**
 * #1045 — the tester-visible Progress loop on the Session-review surface. Shows the deterministic
 * direction line, EXACTLY TWO takeaways (an observation + the single action), and the "Practice this next"
 * button. Accepting records a recommendation attempt (server-owned) and sends the user into their next
 * practice; the resulting session is associated with the attempt when it is saved (see the save seam).
 *
 * Renders nothing until an eligible evaluation exists for this session — including the whole period before
 * the migrations are applied — so the surface safely tolerates the pre-apply state. #1047 may restyle it.
 */
export const ProgressPanel: React.FC<{
    session: Pick<PracticeSession, 'id'>;
    sessionHistory: PracticeSession[];
}> = ({ session, sessionHistory }) => {
    const navigate = useNavigate();
    const { user } = useAuthProvider();
    const userId = user?.id ?? null;
    const [accepting, setAccepting] = useState(false);

    const createdAtById = useMemo(() => {
        const map: Record<string, string | null | undefined> = {};
        for (const s of sessionHistory) map[s.id] = s.created_at;
        return map;
    }, [sessionHistory]);

    const { data: view } = useQuery({
        queryKey: ['sessionProgress', session.id, userId],
        queryFn: () => loadSessionProgress(session.id, createdAtById),
        enabled: !!session.id,
        staleTime: 60 * 1000,
    });

    if (!view) return null; // no eligible evaluation yet (incl. pre-migration) → render nothing

    const onAccept = async () => {
        if (!view.recommendationId || !userId || accepting) return;
        setAccepting(true);
        try {
            const attemptId = await recordRecommendationAttempt(view.recommendationId);
            if (attemptId) {
                // Remember the open attempt so the NEXT saved session resolves it (server derives the outcome).
                setOpenAttempt({ attemptId, userId, sourceSessionId: session.id });
            }
        } catch (err) {
            logger.warn({ err, sessionId: session.id }, '[progress] accept recommendation failed (non-fatal)');
        } finally {
            setAccepting(false);
            navigate('/session'); // into the next practice regardless — recording must never be blocked
        }
    };

    return (
        <section
            data-testid="progress-panel"
            aria-label="Your progress and next action"
            className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4"
        >
            <div>
                <p className="text-xs font-bold uppercase tracking-wide text-primary">Your progress</p>
                <p className="mt-1 text-sm text-foreground/80" data-testid="progress-direction">{view.direction.text}</p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
                <div data-testid="progress-what-worked">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-foreground/55">What worked</dt>
                    <dd className="mt-0.5 text-sm text-foreground/80">{view.takeaways.whatWorked}</dd>
                </div>
                <div data-testid="progress-practice-next">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-primary">{PRACTICE_THIS_NEXT_LABEL}</dt>
                    <dd className="mt-0.5 text-sm text-foreground/80">{view.takeaways.practiceThisNext}</dd>
                </div>
            </dl>

            <Button
                type="button"
                onClick={() => { void onAccept(); }}
                disabled={accepting || !view.recommendationId}
                data-testid="progress-accept"
            >
                {PRACTICE_THIS_NEXT_LABEL}
            </Button>
        </section>
    );
};

export default ProgressPanel;
