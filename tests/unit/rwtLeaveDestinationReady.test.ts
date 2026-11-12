// AHT-09 (Sam, #1811 RETURN item 2): the leave-destination wait is bound to THIS navigation and to the Focus Points destination's
// committed UI, so a stale `data-app-visible-ready="true"` from /session, or a `true` set before the destination mounts, never passes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
    leaveDestinationReady, onFocusDestination, waitForLeaveDestinationReady, type LeaveDestinationSnapshot, type VisibleReadyWrite,
} from '../live/helpers/rwtLeaveDestinationReady';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEST = { path: '/practice', search: '?product=focus-points' };
const SESSION = { path: '/session', search: '' };
const w = (v: string, at: { path: string; search: string }): VisibleReadyWrite => ({ v, ...at });
const snap = (over: Partial<LeaveDestinationSnapshot>): LeaveDestinationSnapshot => ({
    log: [w('false', DEST), w('true', DEST)], ...DEST, visibleReady: 'true', destinationMounted: true, ...over,
});

describe('leaveDestinationReady — pure decision', () => {
    it('this navigation reset readiness on the destination, set it again there, and the destination UI is mounted → ready', () => {
        expect(leaveDestinationReady(snap({}))).toEqual({ ready: true });
    });
    it('STALE: the flag is still true from /session and no reset was recorded on the destination → not ready', () => {
        const v = leaveDestinationReady(snap({ log: [] }));
        expect(v.ready).toBe(false);
        expect(!v.ready && v.reason).toMatch(/stale/);
    });
    it('STALE: writes recorded only on /session (before the route changed) never count for the destination', () => {
        expect(leaveDestinationReady(snap({ log: [w('false', SESSION), w('true', SESSION)] })).ready).toBe(false);
    });
    it('reset on the destination but not yet set again there → not ready, even though the attribute reads true', () => {
        expect(leaveDestinationReady(snap({ log: [w('true', SESSION), w('false', DEST)] })).ready).toBe(false);
    });
    it('DELAYED MOUNT: readiness true on the destination but its UI not mounted yet → not ready', () => {
        const v = leaveDestinationReady(snap({ destinationMounted: false }));
        expect(v.ready).toBe(false);
        expect(!v.ready && v.reason).toMatch(/not mounted/);
    });
    it('the flag currently false → not ready', () => {
        expect(leaveDestinationReady(snap({ visibleReady: 'false' })).ready).toBe(false);
    });
    it('a different route or product → not ready', () => {
        expect(leaveDestinationReady(snap({ search: '?product=open-mic' })).ready).toBe(false);
        expect(leaveDestinationReady(snap({ path: '/session', search: '' })).ready).toBe(false);
        expect(onFocusDestination('/practice', '?x=1&product=focus-points')).toBe(true);
    });
    it('a replaced document (recorder gone): its own flag and the destination UI decide', () => {
        expect(leaveDestinationReady(snap({ log: null })).ready).toBe(true);
        expect(leaveDestinationReady(snap({ log: null, destinationMounted: false })).ready).toBe(false);
    });
});

/** A page whose snapshot reads return the given sequence (the last one repeats). */
function fakePage(seq: LeaveDestinationSnapshot[]): { page: Page; reads: () => number } {
    let i = 0;
    const page = {
        evaluate: async () => seq[Math.min(i++, seq.length - 1)],
        waitForTimeout: async () => undefined,
    } as unknown as Page;
    return { page, reads: () => i };
}

describe('waitForLeaveDestinationReady — polling', () => {
    it('DELAYED MOUNT: keeps polling through a stale true and an unmounted destination, then resolves once both hold', async () => {
        const { page, reads } = fakePage([
            snap({ log: [], ...SESSION }),
            snap({ log: [] }),
            snap({ log: [w('false', DEST)], visibleReady: 'false', destinationMounted: false }),
            snap({ destinationMounted: false }),
            snap({}),
        ]);
        await expect(waitForLeaveDestinationReady(page, 5_000, 0)).resolves.toBeUndefined();
        expect(reads()).toBe(5);
    });
    it('STALE forever: throws with the stale reason at its bound, never a silent pass', async () => {
        const { page } = fakePage([snap({ log: [] })]);
        await expect(waitForLeaveDestinationReady(page, 50, 0)).rejects.toThrow(/never became ready.*stale/);
    });
    it('the AHT-09 spec marks before the leave click and waits through this helper, not the bare global flag', () => {
        const spec = readFileSync(path.resolve(here, '../live/rwt-abandon-and-two-tabs.live.spec.ts'), 'utf8');
        const mark = spec.indexOf('await markBeforeLeave(page);');
        const leave = spec.indexOf("await openProductsItem(page, 'focus-points');");
        const wait = spec.indexOf('await waitForLeaveDestinationReady(page, 30_000);');
        const read = spec.indexOf('const afterLeaving = await tabState(page);');
        expect(mark).toBeGreaterThan(0);
        expect(mark).toBeLessThan(leave);
        expect(leave).toBeLessThan(wait);
        expect(wait).toBeLessThan(read);
        expect(spec).not.toContain(`locator('html[data-app-visible-ready="true"]').waitFor({ state: 'attached', timeout: 30_000 })`);
    });
});
