/**
 * #1258 G20 — ONE saved review, read for the Session page after Stop and for the Analytics session detail.
 *
 * Read-only. `get-ai-suggestions` generates the review once, after Stop, and saves it on the session row
 * (`sessions.ai_suggestions`). This reads that row and the session's saved Focus Points results under the existing
 * per-user RLS and writes nothing. It NEVER calls `get-ai-suggestions`: opening or reloading Analytics never
 * regenerates the review, resends the transcript or spends coaching quota (runbook v12).
 *
 * The product follows the SESSION, never the page: a session with saved Focus Points results is Focus Points, and its
 * evidence comes from those results; otherwise it is Open Mic and its evidence comes from the stored measured signal.
 * The review ages out with the transcript (migration 20260810120000), so an expired row says so.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { readSavedReview, type SavedReview } from '@/components/practice/lastSessionFix';
import { loadSavedFocusPointsCoverage, type SavedFocusBrief } from '@/services/objective/savedFocusPointsCoverage';
import { focusPointsEvidence, openMicEvidence } from './sessionEvidence';

export type SavedCoaching =
    | { kind: 'review'; review: SavedReview }
    | { kind: 'expired' }
    | { kind: 'none' }
    | { kind: 'error' };

export interface SavedSessionReview {
    coaching: SavedCoaching;
    /** `unknown` only when the Focus Points read itself failed. */
    product: 'open_mic' | 'focus_points' | 'unknown';
    /** "From this session" lines; empty when nothing truthful was saved. */
    evidence: string[];
    /** The saved point set (brief + labels in order), for the practice action on a Focus Points session. */
    focusBrief: SavedFocusBrief | null;
    focusPoints: string[];
}

export async function loadSavedSessionReview(sessionId: string): Promise<SavedSessionReview> {
    const failed: SavedSessionReview = { coaching: { kind: 'error' }, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [] };
    try {
        const supabase = getSupabaseClient();
        const [{ data, error }, focus] = await Promise.all([
            supabase
                .from('sessions')
                .select('ai_suggestions, transcript_state, next_action_signal, duration')
                .eq('id', sessionId)
                .maybeSingle(),
            loadSavedFocusPointsCoverage(sessionId),
        ]);
        if (error) {
            logger.warn({ error }, '[savedSessionReview] session read failed');
            return failed;
        }
        const row = data as {
            ai_suggestions?: unknown; transcript_state?: unknown; next_action_signal?: unknown; duration?: unknown;
        } | null;
        if (!row) return failed;

        const review = readSavedReview(row.ai_suggestions);
        const coaching: SavedCoaching = review
            ? { kind: 'review', review }
            : row.transcript_state === 'expired'
                ? { kind: 'expired' }
                // A stored value that fails the contract is not a review, and not "none" either.
                : row.ai_suggestions !== null && row.ai_suggestions !== undefined
                    ? { kind: 'error' }
                    : { kind: 'none' };

        const duration = typeof row.duration === 'number' ? row.duration : null;
        if (focus.kind === 'coverage') {
            return {
                coaching, product: 'focus_points', evidence: focusPointsEvidence(focus.points, duration),
                focusBrief: focus.brief, focusPoints: focus.points.map((p) => p.label)
            };
        }
        if (focus.kind === 'none') {
            return { coaching, product: 'open_mic', evidence: openMicEvidence(row.next_action_signal), focusBrief: null, focusPoints: [] };
        }
        // The Focus Points read failed: the product is unknown, so no evidence is shown rather than the wrong kind.
        return { coaching, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [] };
    } catch (err) {
        logger.warn({ err }, '[savedSessionReview] read threw');
        return failed;
    }
}
