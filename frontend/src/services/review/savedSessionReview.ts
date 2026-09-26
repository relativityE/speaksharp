/**
 * #1258 G20 — ONE saved review, read for the Session page after Stop and for the Analytics session detail.
 *
 * Read-only. `get-ai-suggestions` generates the review once, after Stop, and saves it on the session row
 * (`sessions.ai_suggestions`). This reads that row and the session's saved Focus Points results under the existing
 * per-user RLS and writes nothing. It NEVER calls `get-ai-suggestions`: opening or reloading Analytics never
 * regenerates the review, resends the transcript or spends coaching quota (runbook v12).
 *
 * The product follows the SESSION, never the page, and is never inferred from an ABSENCE (#1535 Codex P2): the durable
 * `sessions.product` marker (#1537, written at creation) decides, and a failed Focus results read never overrides it
 * (PM RETURN 5849471237): a marked Focus take whose results can't be read stays Focus Points with a retryable read
 * error, and a marked Open Mic take stays Open Mic. A row without the marker (created before it) is Focus Points only
 * when a durable Focus row exists (`objective_session` or `objective_source_recording`), and is otherwise `unknown` —
 * never guessed as Open Mic.
 * The review ages out with the transcript (migration 20260810120000), so an expired row says so.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { readSavedReview, type SavedReview } from '@/components/practice/lastSessionFix';
import { loadSavedFocusPointsCoverage, type SavedFocusBrief } from '@/services/objective/savedFocusPointsCoverage';
import { focusPointsEvidence, openMicEvidence } from './sessionEvidence';

/** Shown for a Focus Points take whose point results were not saved (the marker or a source row proves it was Focus). */
export const FOCUS_RESULTS_NOT_SAVED = 'Focus Points results weren’t saved for this take.';

export type SavedCoaching =
    | { kind: 'review'; review: SavedReview }
    | { kind: 'expired' }
    | { kind: 'none' }
    | { kind: 'error' };

export interface SavedSessionReview {
    coaching: SavedCoaching;
    /** `unknown` when no durable authority says which product this was, or a read failed. */
    product: 'open_mic' | 'focus_points' | 'unknown';
    /** "From this session" lines; empty when nothing truthful was saved. */
    evidence: string[];
    /** The saved point set (brief + labels in order), for the practice action on a Focus Points session. */
    focusBrief: SavedFocusBrief | null;
    focusPoints: string[];
    /** A marked Focus Points take whose saved results couldn't be read: its point set is unknown until a re-read. */
    focusReadFailed?: true;
}

export async function loadSavedSessionReview(sessionId: string): Promise<SavedSessionReview> {
    const failed: SavedSessionReview = { coaching: { kind: 'error' }, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [] };
    try {
        const supabase = getSupabaseClient();
        const readRow = (columns: string) => supabase.from('sessions').select(columns).eq('id', sessionId).maybeSingle();
        const [first, focus] = await Promise.all([
            readRow('ai_suggestions, transcript_state, next_action_signal, duration, product'),
            loadSavedFocusPointsCoverage(sessionId),
        ]);
        // Before the marker migration is applied the column does not exist: read the row without it (legacy NULL).
        const missingColumn = (e: { code?: string; message?: string } | null) =>
            Boolean(e && (e.code === '42703' || e.code === 'PGRST204' || /product/.test(e.message ?? '')));
        const { data, error } = first.error && missingColumn(first.error as { code?: string; message?: string })
            ? await readRow('ai_suggestions, transcript_state, next_action_signal, duration')
            : first;
        if (error) {
            logger.warn({ error }, '[savedSessionReview] session read failed');
            return failed;
        }
        const row = data as {
            ai_suggestions?: unknown; transcript_state?: unknown; next_action_signal?: unknown; duration?: unknown; product?: unknown;
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
        const marker = row.product === 'open_mic' || row.product === 'focus_points' ? row.product : null;
        const unknown: SavedSessionReview = { coaching, product: 'unknown', evidence: [], focusBrief: null, focusPoints: [] };
        // A Focus Points take whose point results were not saved: truthful, and its practice action opens Focus setup
        // (no brief to restore) — never Open Mic, never a cleared brief.
        const focusWithoutResults: SavedSessionReview = {
            coaching, product: 'focus_points', evidence: [FOCUS_RESULTS_NOT_SAVED], focusBrief: null, focusPoints: []
        };

        // The stored marker is the product identity; a failed Focus results read never erases it.
        if (marker === 'open_mic') {
            return { coaching, product: 'open_mic', evidence: openMicEvidence(row.next_action_signal), focusBrief: null, focusPoints: [] };
        }
        if (focus.kind === 'coverage') {
            return {
                coaching, product: 'focus_points', evidence: focusPointsEvidence(focus.points, duration),
                focusBrief: focus.brief, focusPoints: focus.points.map((p) => p.label)
            };
        }
        if (marker === 'focus_points') {
            return focus.kind === 'error'
                ? { coaching, product: 'focus_points', evidence: [], focusBrief: null, focusPoints: [], focusReadFailed: true }
                : focusWithoutResults;
        }
        if (focus.kind === 'error') return unknown; // legacy row: no evidence rather than the wrong kind

        // Legacy row (no marker): only a durable Focus row may say Focus Points; absence proves nothing.
        const { data: source, error: sourceError } = await supabase
            .from('objective_source_recording')
            .select('session_id')
            .eq('session_id', sessionId)
            .maybeSingle();
        if (sourceError) {
            logger.warn({ error: sourceError }, '[savedSessionReview] source-recording read failed');
            return unknown;
        }
        return source ? focusWithoutResults : unknown;
    } catch (err) {
        logger.warn({ err }, '[savedSessionReview] read threw');
        return failed;
    }
}
