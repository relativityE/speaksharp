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
