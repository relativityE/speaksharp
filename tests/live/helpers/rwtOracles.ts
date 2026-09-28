/**
 * #1532 — pure, dependency-free RWT oracles (unit-tested in tests/unit/rwtOracles1532.test.ts), closing the open
 * Codex P1s on b5071da25. Content-free: verdicts, fixed details and counts only.
 */
import type { Verdict } from './rwtAcceptance';

/**
 * r4105978609 — the pre-credential surface is approved only when the app's centralized readiness authority
 * (`data-app-visible-ready`, via the shared `waitForAppVisibleReady`) agreed. A visible form is not readiness proof.
 */
export function surfaceReadinessFailures(appVisibleReady: boolean): string[] {
    return appVisibleReady ? [] : ['the app never reported data-app-visible-ready; the route is not committed'];
}

export type FocusRailStatus = 'pending' | 'partial' | 'covered' | 'missing';

/**
 * r4105978619 — exact per-point expectations. `partial` must be PARTIAL (the partial fixture exists to exercise the
 * yellow state); the retired loose `not-covered-or-partial` matches nothing, so a manifest still using it fails.
 */
export function focusPointMeetsExpectation(expected: string, got: FocusRailStatus | null): boolean {
    if (expected === 'covered' || expected === 'partial' || expected === 'missing') return got === expected;
    return false;
}

/** The product persists covered OR partial evidence as detected, so the expected detected count includes partial. */
export function detectedCountExpected(expectedFinal: readonly string[]): number {
    return expectedFinal.filter((e) => e === 'covered' || e === 'partial').length;
}

/**
 * r4105978630 — retention is proven only AFTER the run-owned account is deleted: the report must still exist and its
 * user link must be cleared (user_issue_reports.user_id ON DELETE SET NULL). Anything unproven is HOLD, never PASS.
 */
export function feedbackRetentionVerdict(input: {
    reportId: string | null;
    deletion: 'deleted' | 'failed';
    read: { error: boolean; rows: ReadonlyArray<{ user_id: unknown }> } | null;
}): { verdict: Verdict; detail: string; evidence: Record<string, number | boolean> } {
    if (!input.reportId) {
        return { verdict: 'HOLD', detail: 'no report was stored exactly once, so retention after deletion cannot be checked', evidence: { checked: false } };
    }
    if (input.deletion !== 'deleted' || !input.read) {
        return { verdict: 'HOLD', detail: 'the run-owned account deletion did not complete; retention after deletion is unproven', evidence: { checked: false } };
    }
    if (input.read.error) {
        return { verdict: 'HOLD', detail: 'the post-deletion report read failed; retention is unproven', evidence: { checked: false } };
    }
    const rows = input.read.rows.length;
    const unlinked = rows === 1 && input.read.rows[0].user_id === null;
    if (unlinked) {
        return { verdict: 'PASS', detail: 'after the account was deleted, the report is still stored with its user link cleared', evidence: { rows, userLinkCleared: true } };
    }
    return {
        verdict: 'FAIL',
        detail: rows === 0 ? 'the report was deleted with the account' : 'after deletion the report is not exactly one row with its user link cleared',
        evidence: { rows, userLinkCleared: false },
    };
}

/** The content-free timing fields of the app's own `private_model_acquisition_success` receipt. */
export interface AcquisitionTiming {
    cacheResult?: string;
    completeness?: string;
    downloadMs?: number | null;
    initMs?: number | null;
    totalMs?: number | null;
}

/**
 * v12 preflight (PM 5859727542) — first-use DOWNLOAD vs engine SETUP timing, taken from the app's own acquisition
 * receipt (`download_ms` / `init_ms`, measured by the app, never estimated here). The FIRST acquisition in the journey
 * is the first-use cost. PASS only when both halves were measured (`measurement_completeness: complete`); a missing
 * receipt, a partial measurement or a missing half is HOLD — timing that was not measured is never reported as measured.
 * This row records timing; it applies no performance threshold.
 */
export function acquisitionTimingVerdict(receipts: readonly AcquisitionTiming[]): {
    verdict: Verdict; detail: string; evidence: Record<string, string | number | boolean | null>;
} {
    const first = receipts[0];
    const count = receipts.length;
    if (!first) return { verdict: 'HOLD', detail: 'no model acquisition receipt was sent, so download vs setup timing is unobserved', evidence: { acquisitions: 0 } };
    // Browser-sent receipt fields (what the page sent to PostHog), not the PostHog-received readback.
    const evidence = {
        evidenceClass: 'browser_sent', acquisitions: count, cacheResult: first.cacheResult ?? null,
        completeness: first.completeness ?? null, downloadMs: first.downloadMs ?? null, initMs: first.initMs ?? null,
        totalMs: first.totalMs ?? null,
    };
    // PM 5860859136: a first-use DOWNLOAD claim needs a proven cold acquisition (`cache_result: miss`).
    if (first.cacheResult !== 'miss') {
        return { verdict: 'HOLD', detail: `the first acquisition was not a cold download (cache_result ${first.cacheResult ?? 'absent'}), so first-use download timing is not shown`, evidence };
    }
    const measured = first.completeness === 'complete'
        && typeof first.downloadMs === 'number' && typeof first.initMs === 'number';
    return measured
        ? { verdict: 'PASS', detail: 'the cold first-use model download and engine setup were measured separately by the app', evidence }
        : { verdict: 'HOLD', detail: 'the first acquisition was not completely measured, so download vs setup cannot be separated', evidence };
}

/**
 * #1538 (PROPOSAL for PM, 2026-09-28) — FOCUS COACHING PROVENANCE. The saved pair is Focus coaching only when the
 * server generated it from the saved point results (`gemini_coaching_focus_v1`), and the page asked as a client that
 * reads that provenance (`accepted_coaching_versions`). A legacy request is answered with a relabelled v1 copy, so it
 * cannot prove what the person saw was Focus provenance. No saved version is a HOLD, never a pass.
 */
export function focusCoachingProvenanceVerdict(input: { savedVersion: string | null | undefined; acceptedVersions: unknown }): {
    verdict: 'PASS' | 'FAIL' | 'HOLD'; detail: string;
} {
    const capable = Array.isArray(input.acceptedVersions) && input.acceptedVersions.includes('gemini_coaching_focus_v1');
    if (typeof input.savedVersion !== 'string' || input.savedVersion === '') {
        return { verdict: 'HOLD', detail: 'no saved coaching version to read' };
    }
    if (input.savedVersion !== 'gemini_coaching_focus_v1') {
        return { verdict: 'FAIL', detail: `saved pair is ${input.savedVersion}: not generated from the saved point results` };
    }
    if (!capable) return { verdict: 'FAIL', detail: 'the coaching request did not declare it reads Focus provenance' };
    return { verdict: 'PASS', detail: 'saved pair generated from the saved point results; the request declared Focus provenance' };
}

/**
 * #1532 Codex P1 r4119969323 (PM RETURN 5866220417) — READBACK STAGES ARE BOUND TO THE JOURNEY THAT EXERCISED THEM.
 *
 * A reload mints a new journey id. The full suites follow the PO's manual v12 order (PM RETURN 5870036039): Analytics
 * (list, PDF, detail, reload) BEFORE Share feedback, so feedback lands in the journey the reload minted. Each stage set
 * is bound to the journey that exercised it — never one journey claimed for events that span two: the recording stages bind to the
 * journey of the FIRST canary `session_saved` (the take the suite verifies); `share_feedback` to the journey of the
 * first canary `feedback_submit`; `session_pdf_export` to the journey of the first canary `session_pdf_downloaded`. Every other canary journey is reported, never qualified. A required anchor that was
 * never sent is listed in `missingBindings` (fail closed), never dropped. A feedback-only journey is qualified against
 * its own stage families, singletons and (no) acquisition — `exactlyOnceFamiliesForStages` / `declaresRecordingStage`.
 */
export type { ReadbackBinding } from './rwtAcceptance';
import type { ReadbackBinding } from './rwtAcceptance';
export interface ReadbackPlan { journeys: ReadbackBinding[]; reportedJourneyIds: string[]; missingBindings: string[] }

export function bindReadbackJourneys(
    events: readonly { event: string; at: number; journeyId?: string; trafficType?: string }[],
    plan: { recording: readonly string[]; feedback: boolean; pdfExport?: boolean },
): ReadbackPlan {
    const canary = events.filter((e) => e.trafficType === 'canary' && typeof e.journeyId === 'string' && e.journeyId !== '');
    const anchor = (name: string): string | null =>
        [...canary].filter((e) => e.event === name).sort((a, b) => a.at - b.at)[0]?.journeyId ?? null;
    const bound = new Map<string, string[]>();
    const missingBindings: string[] = [];
    const bind = (journeyId: string | null, stages: readonly string[], label: string) => {
        if (!journeyId) { missingBindings.push(label); return; }
        bound.set(journeyId, [...(bound.get(journeyId) ?? []), ...stages]);
    };
    if (plan.recording.length > 0) bind(anchor('session_saved'), plan.recording, 'recording');
    if (plan.feedback) bind(anchor('feedback_submit'), ['share_feedback'], 'share_feedback');
    // The v12 PDF is downloaded after the detail reload (Back to Dashboard → Download PDF), so it binds to its own journey.
    if (plan.pdfExport) bind(anchor('session_pdf_downloaded'), ['session_pdf_export'], 'session_pdf_export');
    const journeys = [...bound].map(([journeyId, stages]) => ({ journeyId, stages }));
    const reportedJourneyIds = [...new Set(canary.map((e) => e.journeyId as string))].filter((j) => !bound.has(j));
    return { journeys, reportedJourneyIds, missingBindings };
}

export { runJourneyIds } from './rwtAcceptance';

/**
 * #1532 Codex P2 r4120338752 (PM RETURN 5866867380) — THE SAVED VERDICT OF EACH POINT MATCHES THE RAIL, BY POINT.
 *
 * Returns the rail indices whose persisted verdict does not match (empty = PASS). Points are ordered by their saved
 * `sort_order` (the rail's order); the product persists `covered` OR `partial` as `detected` and `missing` as
 * `not_detected`. A point with no row, more than one row, `unavailable`, or a still-pending rail status is a mismatch;
 * a row naming a point outside this brief is reported as index -1. Counts are never compared.
 */
export function persistedVerdictMismatches(
    rail: readonly (FocusRailStatus | null)[],
    points: readonly { id: string; sort_order: number }[],
    evidence: readonly { brief_point_id: string; verdict: string }[],
): number[] {
    const ordered = [...points].sort((a, b) => a.sort_order - b.sort_order);
    const indexOf = new Map(ordered.map((p, i) => [p.id, i] as const));
    const expected = (s: FocusRailStatus | null): string | null =>
        s === 'covered' || s === 'partial' ? 'detected' : s === 'missing' ? 'not_detected' : null;
    const mismatches = new Set<number>();
    if (evidence.some((r) => !indexOf.has(r.brief_point_id))) mismatches.add(-1);
    rail.forEach((status, i) => {
        const rows = evidence.filter((r) => indexOf.get(r.brief_point_id) === i);
        const want = expected(status);
        if (want === null || rows.length !== 1 || rows[0].verdict !== want) mismatches.add(i);
    });
    if (ordered.length !== rail.length) mismatches.add(-1);
    return [...mismatches].sort((a, b) => a - b);
}
