/**
 * #1882 — the Focus take right after the product switch lost its rail and Start a new set.
 *
 * The page judges a take on its LIVE clock: `useSessionStore.setCaptureLive` re-bases `startTime` when capture goes live, and
 * `useSessionLifecycle` sends a take under `MIN_SESSION_DURATION_SECONDS` (5) down the "too short" branch. The journey timed
 * the switch take from the Start click, so a slow capture start left under five live seconds of a nine-second press.
 *
 * These helpers only wait and read. They never press anything, so the Start-press budget is unchanged.
 */
import type { Page } from '@playwright/test';

/** The page's own "take is live" state: listening AND capture live (SessionOverhaulView `resolveSessionState`). */
export const LIVE_TAKE_SELECTOR = '[data-testid="session-shell"][data-session-state="during"]';

/** The Focus points rail's actual rows: one `<li data-testid="focus-point-i">` per point (FocusPointsRail.tsx). */
export const RAIL_ROW_SELECTOR = '[data-testid="focus-points-rail-list"] > li';

export interface LiveTimedTake {
    /** Ms from just before the Start press to the page showing the live take; null when it never went live in budget. */
    pressToLiveMs: number | null;
    /** Live seconds the take was held for (0 when capture never went live). */
    heldLiveSeconds: number;
}

/**
 * Hold the current take for `liveSeconds` on the page's live clock. Call right after `startBenchmarkRecording`, passing the
 * time read just before it. When capture never goes live within `liveTimeoutMs`, it returns at once with
 * `pressToLiveMs: null` and holds nothing, so the caller still stops the take and the row reads the real outcome.
 */
export async function holdLiveTake(page: Page, liveSeconds: number, pressedAtMs: number, liveTimeoutMs = 60_000): Promise<LiveTimedTake> {
    if (!Number.isFinite(liveSeconds) || liveSeconds <= 0) throw new Error('INVALID_SETUP live take seconds must be finite and positive');
    const live = await page.locator(LIVE_TAKE_SELECTOR).first().waitFor({ state: 'visible', timeout: liveTimeoutMs })
        .then(() => true, () => false);
    if (!live) return { pressToLiveMs: null, heldLiveSeconds: 0 };
    const pressToLiveMs = Math.max(0, Date.now() - pressedAtMs);
    await page.waitForTimeout(Math.round(liveSeconds * 1000));
    return { pressToLiveMs, heldLiveSeconds: liveSeconds };
}

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
