// @vitest-environment node
/**
 * #1882 — the Focus take right after the product switch (live run 43715342978) was reviewed with no rail rows and no Start a
 * new set. Root cause (handback/1882-root-cause-2026-11-17): the journey held the take 9 s from the Start CLICK, while the
 * page judges it on the LIVE clock. The live hold is now MEASURED by rwtLiveTakeMonitor.ts (its behaviour and controls are in
 * rwtLiveTakeMonitor1882.test.ts). This file binds the rail-settled rule and the switch verdict to four ACTUAL rows.
 */
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { RAIL_ROW_SELECTOR, railSettled, readRailRowCount } from '../live/helpers/rwtLiveTimedTake';
import { switchIsolationVerdict, type SwitchIsolationObservation } from '../live/helpers/rwtOracles';

const railPage = (rows: number) => ({
    locator: (selector: string) => ({
        count: async () => { if (selector !== RAIL_ROW_SELECTOR) throw new Error(`unknown selector ${selector}`); return rows; },
    }),
} as unknown as Page);

describe('#1882 — the rail settles only with four actual rows', () => {
    const empty = [null, null, null, null];

    it('an EMPTY rail is never settled (main\'s rule accepted it at once)', async () => {
        const mainRule = (statuses: readonly (string | null)[]) => statuses.every((s) => s !== 'pending');
        expect(mainRule(empty)).toBe(true); // the gap: absent rows read null, and null is not 'pending'
        expect(railSettled(0, empty, 4)).toBe(false);
    });

    it('pending, truncated, extra, unreadable or uncountable rails are not settled; four settled rows are', () => {
        expect(railSettled(4, ['pending', 'pending', 'pending', 'pending'], 4)).toBe(false);
        expect(railSettled(4, ['covered', 'missing', 'pending', 'missing'], 4)).toBe(false);
        expect(railSettled(3, ['covered', 'missing', 'missing', null], 4)).toBe(false);
        expect(railSettled(5, ['covered', 'missing', 'missing', 'missing'], 4)).toBe(false);
        expect(railSettled(4, ['covered', 'missing', null, 'missing'], 4)).toBe(false);
        expect(railSettled(null, ['covered', 'missing', 'missing', 'missing'], 4)).toBe(false);
        expect(railSettled(4, ['covered', 'missing', 'missing', 'missing'], 4)).toBe(true);
    });

    it('reads the row count from the rail list; an unreadable count is null, never a number', async () => {
        expect(await readRailRowCount(railPage(4))).toBe(4);
        const broken = { locator: () => ({ count: async () => { throw new Error('detached'); } }) } as unknown as Page;
        expect(await readRailRowCount(broken)).toBeNull();
    });
});

describe('#1882 — the switch verdict needs four actual rail rows', () => {
    const clean: SwitchIsolationObservation = {
        railPendingBefore: true, openMicId: 'om', focusId: 'fp', savedProduct: 'focus_points',
        finalStatuses: ['covered', 'missing', 'missing', 'missing'], staleCoachingBeforeStart: false, markerSupport: [true, true, true],
        openMicBefore: { product: 'open_mic', digest: 'd1' }, openMicAfter: { product: 'open_mic', digest: 'd1' },
    };

    it('PASS with exactly four rows', () => {
        expect(switchIsolationVerdict({ ...clean, railRowCount: 4 }).verdict).toBe('PASS');
    });

    it('FAIL with no rows, too few, too many or an unreadable count, even when four statuses were read', () => {
        for (const railRowCount of [0, 3, 5, null]) {
            const v = switchIsolationVerdict({ ...clean, railRowCount });
            expect(v.verdict).toBe('FAIL');
            expect(v.detail).toMatch(/not exactly four/);
        }
    });
});
