import { useQuery } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';
import type { PracticeSession } from '@/types/session';

/**
 * G18 §6.1 — the `before` card states THE MOVE between the two most recent comparable runs, in the unit the
 * rest of the app already speaks: `82% → 88%`.
 *
 * It reads the SAME authority the Progress panel reads — `loadSessionProgress()` on the newest saved session —
 * so the two surfaces cannot disagree about eligibility, cohort or reference. It never recomputes clarity from
 * a raw row: a second implementation of the contract is a second answer.
 *
 * Five outcomes, two bodies (§6.1). Anything that is not a real comparison — first session, no qualifying
 * predecessor, restarted cohort, ineligible, or a failed read — is the no-number body. Absence is a
 * first-class state here, never an error and never `—`.
 */
export type ClarityMove =
    | {
        kind: 'move';
        /** The previous comparable session's clarity, as a whole percent. */
        previousPercent: number;
        /** The newest comparable session's clarity, as a whole percent. */
        currentPercent: number;
        /** `held_steady` is a real comparison under the 3-point significance threshold (§6.1). */
        direction: 'improved' | 'declined' | 'held_steady';
        /** How the reference session is named to the user, e.g. `14 Sep`. */
        referenceDateLabel: string;
    }
    | { kind: 'first-session' }
    | { kind: 'no-comparison' };

/** `14 Sep` — the reference session's own date, never a rolling window. */
export const formatReferenceDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
};

/**
 * @param history newest-first saved sessions (`usePracticeHistory`)
 */
export function useClarityMove(history: readonly PracticeSession[] | undefined): ClarityMove {
    const { user } = useAuthProvider();
    const userId = user?.id ?? null;
    const latest = history && history.length > 0 ? history[0] : null;

    const query = useQuery({
        queryKey: ['sessionProgress', latest?.id, userId],
        queryFn: () => loadSessionProgress(latest!.id),
        enabled: !!latest?.id,
        staleTime: 60 * 1000,
    });

    // No history at all is the baseline state: this run becomes the user's first.
    if (!history || history.length === 0) return { kind: 'first-session' };

    // A failed or pending read is NOT an error state on this card — it renders the no-number body.
    const view = query.data;
    if (!view || view.status !== 'eligible') return { kind: 'no-comparison' };
    if (view.comparison !== 'previous' || !view.disclosure) return { kind: 'no-comparison' };

    const { currentClarityPoints, referenceClarityPoints, referenceSessionId } = view.disclosure;
    if (!Number.isFinite(currentClarityPoints) || !Number.isFinite(referenceClarityPoints)) {
        return { kind: 'no-comparison' };
    }

    // The reference is named by its own date, resolved from the session it actually points at.
    const reference = history.find((session) => session.id === referenceSessionId);
    const referenceDateLabel = formatReferenceDate(reference?.created_at);
    if (!referenceDateLabel) return { kind: 'no-comparison' };

    // `direction` carries the product's 3-point significance threshold; `below_policy` is a real comparison
    // that the copy declines to celebrate, so it keeps both numbers and says "Holding steady" (§6.1).
    const direction = view.direction.direction === 'improved'
        ? 'improved' as const
        : view.direction.direction === 'declined'
            ? 'declined' as const
            : view.direction.direction === 'below_policy'
                ? 'held_steady' as const
                : null;
    if (!direction) return { kind: 'no-comparison' };

    return {
        kind: 'move',
        previousPercent: Math.round(referenceClarityPoints),
        currentPercent: Math.round(currentClarityPoints),
        direction,
        referenceDateLabel,
    };
}
