/**
 * #1258 / #1407 — the SAVED Focus Points result for one session, for the Analytics session detail.
 *
 * Read-only. It reads only what the save already persisted (objective_session → objective_brief_point +
 * objective_evidence), under the same per-user row-level security as every other owned read; it computes nothing
 * and writes nothing. Analytics therefore shows the verdicts that were saved — never a re-evaluation that could
 * disagree with what the person saw when they pressed Stop.
 *
 * An Open Mic session has no objective_session, so it resolves to `none` and the detail shows nothing extra.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

export type SavedPointStatus = 'detected' | 'not_detected' | 'unavailable';

export interface SavedFocusPoint {
    label: string;
    status: SavedPointStatus;
    /** Seconds into the take where the point was detected; null unless detected. */
    detectedAtSeconds: number | null;
}

/** The saved point set, so "Practise this again" can rebind exactly this set (never a different one). */
export interface SavedFocusBrief {
    briefId: string;
    projectId: string;
    topic: string;
}

export type SavedFocusPointsCoverage =
    | { kind: 'none' }
    | { kind: 'coverage'; points: SavedFocusPoint[]; detected: number; total: number; brief: SavedFocusBrief | null }
    | { kind: 'error' };

const STATUSES: ReadonlySet<string> = new Set(['detected', 'not_detected', 'unavailable']);

export async function loadSavedFocusPointsCoverage(sourceSessionId: string): Promise<SavedFocusPointsCoverage> {
    try {
        const supabase = getSupabaseClient();
        // The newest objective session recorded for this saved take (normally exactly one).
        const { data: session, error: sessionError } = await supabase
            .from('objective_session')
            .select('id, brief_id')
            .eq('source_session_id', sourceSessionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (sessionError) {
            logger.warn({ error: sessionError }, '[savedFocusPointsCoverage] objective_session read failed');
            return { kind: 'error' };
        }
        if (!session) return { kind: 'none' };

        const briefId = (session as { brief_id: string }).brief_id;
        const [{ data: points, error: pointsError }, { data: evidence, error: evidenceError }, { data: brief }] = await Promise.all([
            supabase.from('objective_brief_point').select('id, label, sort_order')
                .eq('brief_id', (session as { brief_id: string }).brief_id)
                .order('sort_order', { ascending: true }),
            supabase.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds')
                .eq('session_id', (session as { id: string }).id),
            // Only for rebinding the set on "Practise this again"; a failed read leaves the results intact.
            supabase.from('objective_brief').select('project_id, event_goal').eq('id', briefId).maybeSingle(),
        ]);
        if (pointsError || evidenceError) {
            logger.warn({ error: pointsError ?? evidenceError }, '[savedFocusPointsCoverage] point/evidence read failed');
            return { kind: 'error' };
        }

        const byPoint = new Map(((evidence ?? []) as Array<{ brief_point_id: string; verdict: string; detected_at_seconds: number | null }>)
            .map((row) => [row.brief_point_id, row]));
        const rows: SavedFocusPoint[] = ((points ?? []) as Array<{ id: string; label: string }>).map((point) => {
            const row = byPoint.get(point.id);
            // A point with no evidence row, or an unknown verdict, was not evaluated — never shown as detected.
            const status: SavedPointStatus = row && STATUSES.has(row.verdict) ? row.verdict as SavedPointStatus : 'unavailable';
            const at = status === 'detected' && typeof row?.detected_at_seconds === 'number' ? row.detected_at_seconds : null;
            return { label: point.label, status, detectedAtSeconds: at };
        });
        if (rows.length === 0) return { kind: 'error' }; // a saved Focus Points session always has its points
        const briefRow = brief as { project_id?: unknown; event_goal?: unknown } | null;
        const savedBrief: SavedFocusBrief | null = briefRow && typeof briefRow.project_id === 'string' && typeof briefRow.event_goal === 'string'
            ? { briefId, projectId: briefRow.project_id, topic: briefRow.event_goal }
            : null;
        return { kind: 'coverage', points: rows, detected: rows.filter((r) => r.status === 'detected').length, total: rows.length, brief: savedBrief };
    } catch (error) {
        logger.warn({ error }, '[savedFocusPointsCoverage] read threw');
        return { kind: 'error' };
    }
}
