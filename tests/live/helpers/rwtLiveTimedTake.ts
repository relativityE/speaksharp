/**
 * #1882 — the Focus take right after the product switch lost its rail and Start a new set.
 *
 * The page judges a take on its LIVE clock: `useSessionStore.setCaptureLive` re-bases `startTime` when capture goes live, and
 * `useSessionLifecycle` sends a take under `MIN_SESSION_DURATION_SECONDS` (5) down the "too short" branch. The journey timed
 * the switch take from the Start click, so a slow capture start left under five live seconds of a nine-second press.
 *
 * These helpers only read. They never press anything, so the Start-press budget is unchanged.
 *
 * Nov 18 (Sam's reset, row 3): the take's hold moved to rwtLiveTakeMonitor.ts. The former `holdLiveTake` here waited for the
 * live state once, slept, and reported the full hold as held live seconds without looking again; the monitor measures the
 * take continuously through the actual Stop press instead.
 */
import type { Page } from '@playwright/test';

/** The Focus points rail's actual rows: one `<li data-testid="focus-point-i">` per point (FocusPointsRail.tsx). */
export const RAIL_ROW_SELECTOR = '[data-testid="focus-points-rail-list"] > li';

/** How many actual rows the rail shows now; null when it cannot be read. */
export async function readRailRowCount(page: Page): Promise<number | null> {
    return page.locator(RAIL_ROW_SELECTOR).count().catch(() => null);
}

/**
 * The rail has settled only when it shows exactly `expected` actual rows, each with a readable status that is no longer
 * pending. An absent row reads as null, and null is not 'pending', so the old `every((s) => s !== 'pending')` test settled
 * at once on an EMPTY rail. That is the shape run 43715342978 saw: a review with no rail rows.
 */
export function railSettled(rowCount: number | null, statuses: readonly (string | null)[], expected: number): boolean {
    return rowCount === expected && statuses.length === expected && statuses.every((s) => s !== null && s !== 'pending');
}
