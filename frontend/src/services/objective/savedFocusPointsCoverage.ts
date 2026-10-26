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
    | {
        kind: 'coverage'; points: SavedFocusPoint[]; detected: number; total: number; brief: SavedFocusBrief | null;
        /** #1535: the point set could not be READ (a failed request, not an absent brief) — retryable, never "no set". */
        briefReadFailed?: true;
        /**
         * #1577 Codex P2 4236239714: persisted `objective_evidence` rows for this take. Points with no row render as
         * `unavailable`, but the coaching function treats ZERO rows as pending (425), so readiness needs this count.
         */
        evidenceRows?: number;
    }
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
        const [{ data: points, error: pointsError }, { data: evidence, error: evidenceError }, { data: brief, error: briefError }] = await Promise.all([
            supabase.from('objective_brief_point').select('id, label, sort_order')
                .eq('brief_id', (session as { brief_id: string }).brief_id)
                .order('sort_order', { ascending: true }),
            supabase.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds')
                .eq('session_id', (session as { id: string }).id),
            // Only for rebinding the set on "Practise this again": a failed read leaves the results intact but is carried
            // as `briefReadFailed` (#1535 Codex P2 r4116626850), so the action retries instead of opening generic setup.
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
        if (briefError) logger.warn({ error: briefError }, '[savedFocusPointsCoverage] brief read failed');
        return {
            kind: 'coverage', points: rows, detected: rows.filter((r) => r.status === 'detected').length, total: rows.length,
            brief: briefError ? null : savedBrief,
            ...(briefError ? { briefReadFailed: true as const } : {}),
            evidenceRows: (evidence ?? []).length,
        };
    } catch (error) {
        logger.warn({ error }, '[savedFocusPointsCoverage] read threw');
        return { kind: 'error' };
    }
}

/**
 * #1535 (Codex P2 r4116741461) — the session's durable product (`sessions.product`, #1537), read ONLY to decide whether
 * a failed Focus Points read is relevant to show. `open_mic` means no Focus result is expected; `unknown` is a legacy
 * row without the marker; `error` is a failed read (including a pre-migration missing column) — never guessed.
 */
export async function readSavedSessionProduct(sessionId: string): Promise<'open_mic' | 'focus_points' | 'unknown' | 'error'> {
    try {
        const { data, error } = await getSupabaseClient().from('sessions').select('product').eq('id', sessionId).maybeSingle();
        if (error) {
            logger.warn({ error }, '[savedFocusPointsCoverage] session product read failed');
            return 'error';
        }
        const product = (data as { product?: unknown } | null)?.product;
        return product === 'open_mic' || product === 'focus_points' ? product : 'unknown';
    } catch (error) {
        logger.warn({ error }, '[savedFocusPointsCoverage] session product read threw');
        return 'error';
    }
}
