/**
 * AHT-09 (Sam, #1811 RETURN item 2): the leave destination is ready only when THIS navigation's route readiness has committed on the
 * Focus Points destination AND the destination's own UI is mounted. The global `data-app-visible-ready` flag alone is not enough:
 * it can still be `true` from the route being left (App.tsx resets it in an effect, after `waitForURL` may already have resolved),
 * and it is set from "the body shows text", which is true before the destination itself mounts.
 *
 * Binding: before the leave, a recorder logs every write of `data-app-visible-ready` on the document root with the location at
 * that moment. Ready = on the destination route, a reset to `false` AFTER the mark, then a later `true` there, the flag `true` now,
 * and the destination's committed UI present. If the document itself was replaced (no recorder), the flag in the new document can
 * only have been set by that document, so the flag and the destination UI decide.
 */
import type { Page } from '@playwright/test';

export interface VisibleReadyWrite { v: string | null; path: string; search: string }
export interface LeaveDestinationSnapshot {
    /** The recorder installed before the leave survives (same document); null when the document was replaced. */
    log: VisibleReadyWrite[] | null;
    path: string;
    search: string;
    visibleReady: string | null;
    /** The Focus Points destination's own committed UI (the authenticated practice home inside `practice-root`) is rendered. */
    destinationMounted: boolean;
}
export type LeaveDestinationVerdict = { ready: true } | { ready: false; reason: string };

/** The Focus Points leave destination: `/practice?product=focus-points`. */
export function onFocusDestination(path: string, search: string): boolean {
    return path === '/practice' && new URLSearchParams(search).get('product') === 'focus-points';
}

/** Pure decision over one snapshot; the caller polls it until ready or its bound. */
export function leaveDestinationReady(s: LeaveDestinationSnapshot): LeaveDestinationVerdict {
    if (!onFocusDestination(s.path, s.search)) return { ready: false, reason: 'not on the Focus Points destination' };
    if (!s.destinationMounted) return { ready: false, reason: 'the destination UI has not mounted' };
    if (s.visibleReady !== 'true') return { ready: false, reason: 'route readiness is not true' };
    if (s.log === null) return { ready: true };
    const reset = s.log.findIndex((w) => w.v === 'false' && onFocusDestination(w.path, w.search));
    if (reset < 0) return { ready: false, reason: 'readiness was never reset for this navigation (a stale true from the route left)' };
    const committed = s.log.slice(reset + 1).some((w) => w.v === 'true' && onFocusDestination(w.path, w.search));
    if (!committed) return { ready: false, reason: 'readiness has not been set again on the destination since this navigation reset it' };
    return { ready: true };
}

const RECORDER = '__rwtLeaveVisibleReady';
export const DESTINATION_UI = '[data-testid="practice-root"] [data-testid="practice-welcome-authed"]';

/** Install the write recorder on the current document. Call immediately BEFORE the leave action. */
export async function markBeforeLeave(page: Page): Promise<void> {
    await page.evaluate((key) => {
        const root = document.documentElement;
        const log: Array<{ v: string | null; path: string; search: string }> = [];
        const w = window as unknown as Record<string, unknown>;
        (w[key] as { observer?: MutationObserver } | undefined)?.observer?.disconnect();
        const observer = new MutationObserver((records) => {
            for (const r of records) if (r.attributeName === 'data-app-visible-ready') {
                log.push({ v: root.getAttribute('data-app-visible-ready'), path: location.pathname, search: location.search });
            }
        });
        observer.observe(root, { attributes: true, attributeFilter: ['data-app-visible-ready'] });
        w[key] = { log, observer };
    }, RECORDER);
}

export async function leaveDestinationSnapshot(page: Page): Promise<LeaveDestinationSnapshot> {
    return page.evaluate(({ key, ui }) => {
        const rec = (window as unknown as Record<string, { log?: Array<{ v: string | null; path: string; search: string }> } | undefined>)[key];
        const el = document.querySelector(ui);
        return {
            log: rec?.log ? rec.log.slice() : null,
            path: location.pathname, search: location.search,
            visibleReady: document.documentElement.getAttribute('data-app-visible-ready'),
            destinationMounted: Boolean(el && el.getClientRects().length > 0),
        };
    }, { key: RECORDER, ui: DESTINATION_UI });
}

/** Poll until this navigation's destination is ready, or throw with the last reason (never a silent pass). */
export async function waitForLeaveDestinationReady(page: Page, timeoutMs = 30_000, pollMs = 250): Promise<void> {
    // Bounded twice: by wall clock and by poll count (a frozen or faked clock can never make this loop unbounded).
    const deadline = Date.now() + timeoutMs;
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / Math.max(pollMs, 1)));
    let last: LeaveDestinationVerdict = { ready: false, reason: 'not read' };
    for (let poll = 0; poll < maxPolls; poll += 1) {
        if (poll > 0 && Date.now() >= deadline) break;
        last = await leaveDestinationSnapshot(page).then(leaveDestinationReady, () => ({ ready: false, reason: 'the page could not be read' }) as const);
        if (last.ready) return;
        await page.waitForTimeout(pollMs);
    }
    throw new Error(`the Focus Points destination never became ready for this navigation within ${timeoutMs / 1000} s (${last.ready ? 'ready' : last.reason})`);
}
