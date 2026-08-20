/**
 * #1046 G2 — Focus Points capture client seam.
 *
 * Thin, typed wrapper over the two guarded write RPCs added in #1192
 * (`20260807010000_issue_objective_brief.sql`):
 *   - `issue_objective_project_v1(p_title)` → the project a brief attaches to
 *   - `issue_objective_brief_v1(p_project_id, p_event_goal, p_time_budget_seconds, p_audience, p_points)`
 *
 * ALL authority lives in the database: `auth.uid()`, `has_objective_capability()`, owner-scoping, and
 * every field validation are enforced server-side (SECURITY DEFINER, pinned search_path). This client
 * passes typed values only — a buggy/compromised client can neither self-grant capability nor write
 * another user's brief. We mirror the RPC's validation client-side purely to fail fast without a
 * round-trip, and we translate the RPC's SQLSTATE codes into a stable, PII-free `reason` so the UI can
 * show honest copy (never raw DB text).
 *
 * Naming: the service speaks the stable function token `objective_` (backend), never the product label.
 * The customer-facing name ("Focus Points") lives only in `productNames.ts`.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

/** A single focus point the user wants to cover. `label` is required; `cue` is an optional reminder. */
export interface ObjectiveFocusPointInput {
    label: string;
    cue?: string | null;
    /** Defaults true — a required point counts toward coverage. */
    isRequired?: boolean;
}

/** The captured brief. v1 scope (PO): goal + points. Time budget defaulted; audience optional. */
export interface ObjectiveBriefInput {
    /** What is being rehearsed, e.g. "2-minute sales pitch". Non-blank. Doubles as the project title. */
    goal: string;
    points: ObjectiveFocusPointInput[];
    /** Target length for pacing. The RPC requires a POSITIVE value; defaults below when omitted. */
    timeBudgetSeconds?: number;
    /** Optional audience descriptor (e.g. "hiring panel"). */
    audience?: string | null;
}

/** Stable, non-PII failure reasons mapped from the RPC SQLSTATE codes. */
export type ObjectiveBriefFailureReason = 'capability' | 'validation' | 'auth' | 'error';

export interface ObjectiveBriefResult {
    ok: boolean;
    briefId?: string;
    projectId?: string;
    reason?: ObjectiveBriefFailureReason;
}

/** Default target length when the v1 form does not collect one (RPC requires > 0). */
export const DEFAULT_OBJECTIVE_TIME_BUDGET_SECONDS = 120;
export const OBJECTIVE_MIN_POINTS = 1;
export const OBJECTIVE_MAX_POINTS = 7;

/** Map a Postgres error to a stable UI reason. Never surface raw DB text to the user. */
function reasonFromError(error: { code?: string } | null | undefined): ObjectiveBriefFailureReason {
    switch (error?.code) {
        case '42501': return 'capability'; // has_objective_capability() false / not owner
        case '28000': return 'auth';        // auth.uid() null
        case '22023': return 'validation';  // blank goal / non-positive budget / empty points / blank label
        default: return 'error';
    }
}

/**
 * Capture a brief in one call: create the owning project (titled from the goal), then the versioned
 * brief with its focus points. Returns a typed result — `ok:false` with a `reason` on any failure, so
 * the UI never fabricates success. Blank-labelled points are dropped before validation/submit (they
 * mirror the RPC's own non-blank guard). Point order in the array is authoritative — the RPC assigns
 * `sort_order` from loop position, so we send only label/cue/is_required.
 */
export async function startObjectiveBrief(input: ObjectiveBriefInput): Promise<ObjectiveBriefResult> {
    const goal = (input.goal ?? '').trim();
    const points = (input.points ?? [])
        .map((p) => ({ ...p, label: (p.label ?? '').trim(), cue: (p.cue ?? '').trim() }))
        .filter((p) => p.label !== '');

    // Fail fast without a round-trip; the RPC enforces the same rules authoritatively.
    if (goal === '' || points.length < OBJECTIVE_MIN_POINTS) {
        return { ok: false, reason: 'validation' };
    }

    const supabase = getSupabaseClient();

    const { data: projectId, error: projectErr } = await supabase.rpc('issue_objective_project_v1', {
        p_title: goal,
    });
    if (projectErr || !projectId) {
        logger.warn({ error: projectErr }, '[objectiveBrief] issue_objective_project_v1 failed');
        return { ok: false, reason: reasonFromError(projectErr) };
    }

    const { data: briefId, error: briefErr } = await supabase.rpc('issue_objective_brief_v1', {
        p_project_id: projectId,
        p_event_goal: goal,
        p_time_budget_seconds: input.timeBudgetSeconds ?? DEFAULT_OBJECTIVE_TIME_BUDGET_SECONDS,
        p_audience: (input.audience ?? '').trim() || null,
        p_points: points.map((p) => ({
            label: p.label,
            cue: p.cue || null,
            is_required: p.isRequired ?? true,
        })),
    });
    if (briefErr || !briefId) {
        logger.warn({ error: briefErr }, '[objectiveBrief] issue_objective_brief_v1 failed');
        return { ok: false, reason: reasonFromError(briefErr) };
    }

    return { ok: true, projectId: projectId as string, briefId: briefId as string };
}
