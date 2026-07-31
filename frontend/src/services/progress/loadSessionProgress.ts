/**
 * #1045 — read the persisted Progress records for one session and turn them into the deterministic
 * user-facing view (direction + two takeaways + the recommendation to accept). Pure read + pure
 * presentation; all authority already lives in the immutable records.
 *
 * Returns `null` when there is no eligible evaluation for the session yet — including the entire period
 * BEFORE the migrations are applied, when the tables do not exist. The panel then renders nothing, so the
 * frontend safely tolerates the pre-apply state.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import { PROGRESS_FORMULA_VERSION, type ProgressEvaluation } from './buildProgressEvaluation';
import { describeDirection, buildTakeaways, type DirectionResult, type Takeaways } from './progressPresentation';

export interface SessionProgressView {
    direction: DirectionResult;
    takeaways: Takeaways;
    /** The recommendation to accept with "Practice this next"; null if none was recorded. */
    recommendationId: string | null;
    sessionId: string;
}

interface EvalRow {
    session_id: string;
    eligible: boolean;
    clarity_raw: number | null;
    filler_count: number | null;
    wpm: number | null;
    word_count: number | null;
    cohort_key: string | null;
}

function toEvaluation(row: EvalRow): ProgressEvaluation {
    return {
        sessionId: row.session_id,
        userId: '',
        formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: 'at_save',
        durationSeconds: 0,
        wordCount: row.word_count ?? 0,
        clarityEvidenceAvailable: row.eligible,
        engine: null,
        engineVersion: null,
        modelName: null,
        attributionStatus: null,
        eligible: row.eligible,
        exclusionReasons: [],
        clarityRaw: row.clarity_raw,
        fillerCount: row.filler_count,
        errorMarkerCount: null,
        wpm: row.wpm,
        cohortKey: row.cohort_key,
    };
}

/**
 * @param sessionId       the session whose review is being shown
 * @param createdAtById   created_at (ISO) for each of the user's sessions, so baseline/previous are chosen
 *                        by persisted time (never by client ordering) — same rule the server uses.
 */
export async function loadSessionProgress(
    sessionId: string,
    createdAtById: Record<string, string | null | undefined>,
): Promise<SessionProgressView | null> {
    const supabase = getSupabaseClient();

    const { data: evals, error } = await supabase
        .from('session_progress_evaluations')
        .select('session_id, eligible, clarity_raw, filler_count, wpm, word_count, cohort_key')
        .eq('formula_version', PROGRESS_FORMULA_VERSION);
    // Tables absent (pre-apply) or query failed → render nothing; never throw into the surface.
    if (error || !evals) return null;

    const rows = evals as EvalRow[];
    const currentRow = rows.find((r) => r.session_id === sessionId);
    if (!currentRow || !currentRow.eligible) return null; // no eligible evaluation → no Progress view

    const current = toEvaluation(currentRow);
    const time = (id: string): number => {
        const iso = createdAtById[id];
        const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
        return Number.isFinite(t) ? t : 0;
    };
    const currentTime = time(sessionId);

    // Prior ELIGIBLE, SAME-COHORT evaluations, ordered by persisted created_at.
    const prior = rows
        .filter((r) => r.eligible && r.cohort_key === current.cohortKey && r.session_id !== sessionId && time(r.session_id) < currentTime)
        .sort((a, b) => time(a.session_id) - time(b.session_id))
        .map(toEvaluation);

    const baseline = prior.length ? prior[0] : null;
    const previous = prior.length ? prior[prior.length - 1] : null;

    const { data: rec } = await supabase
        .from('progress_recommendations')
        .select('id')
        .eq('source_session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();

    return {
        sessionId,
        direction: describeDirection(current, baseline),
        takeaways: buildTakeaways(current, previous),
        recommendationId: (rec as { id?: string } | null)?.id ?? null,
    };
}
