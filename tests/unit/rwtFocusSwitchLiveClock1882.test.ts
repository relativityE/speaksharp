// @vitest-environment node
/**
 * #1882 — the Focus take right after the product switch (live run 43715342978) was reviewed with no rail rows and no Start a
 * new set. Root cause (handback/1882-root-cause-2026-11-17): the journey held the take 9 s from the Start CLICK, while the
 * page judges it on the LIVE clock (re-based when capture goes live) and treats under MIN_SESSION_DURATION_SECONDS as too short.
 *
 * This drives the journey's own helpers against a model page that keeps the two clocks the way the app does: Start at t0,
 * capture live after a delay, Stop, then a rail of four rows for a take of at least five live seconds and none for a shorter
 * one (production 446e09fa's "too short" shape). It also binds the rail-settled rule and the switch verdict to four ACTUAL rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import { holdLiveTake, LIVE_TAKE_SELECTOR, RAIL_ROW_SELECTOR, railSettled, readRailRowCount } from '../live/helpers/rwtLiveTimedTake';
import { switchIsolationVerdict, type SwitchIsolationObservation } from '../live/helpers/rwtOracles';

/** The journey's switch-take length for focus_points_tts (point 2 starts at 11.98 s): max(8, min(9, 11.98 - 2)) = 9. */
const SHORT_TAKE_SECONDS = Math.max(8, Math.min(9, 11.98 - 2));

/** A page whose clocks behave like the app's: live clock starts at capture live; rows exist only for a long-enough take. */
class ModelPage {
    liveAt: number | null = null;
    railRows = 4; // the Focus set is on screen before Start, all pending
    statuses: Array<'pending' | 'covered' | 'missing'> = ['pending', 'pending', 'pending', 'pending'];
    liveSecondsAtStop: number | null = null;
    tooShort: boolean | null = null;

    constructor(private readonly pressToLiveMs: number | null) {}

    press(): void {
        if (this.pressToLiveMs !== null) setTimeout(() => { this.liveAt = Date.now(); }, this.pressToLiveMs);
    }

    stop(): void {
        this.liveSecondsAtStop = this.liveAt === null ? 0 : (Date.now() - this.liveAt) / 1000;
        this.tooShort = this.liveSecondsAtStop < MIN_SESSION_DURATION_SECONDS;
        // 446e09fa: a too-short take saves but the page never reaches `after`, so the rail has no points (0 rows).
        if (this.tooShort) { this.railRows = 0; this.statuses = []; return; }
        this.statuses = ['covered', 'missing', 'missing', 'missing'];
    }

    asPage(): Page {
        const locator = (selector: string) => ({
            first: () => locator(selector),
            count: async () => {
                if (selector === RAIL_ROW_SELECTOR) return this.railRows;
                if (selector === LIVE_TAKE_SELECTOR) return this.liveAt === null || this.liveSecondsAtStop !== null ? 0 : 1;
                throw new Error(`model page: unknown selector ${selector}`);
            },
            waitFor: async ({ timeout }: { timeout: number }) => {
                if (selector !== LIVE_TAKE_SELECTOR) throw new Error(`model page: unexpected wait on ${selector}`);
                const deadline = Date.now() + timeout;
                while (this.liveAt === null) {
                    if (Date.now() >= deadline) throw Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
                    await new Promise((r) => setTimeout(r, 50));
                }
            },
        });
        return {
            locator,
            waitForTimeout: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        } as unknown as Page;
    }
}

/** The switch take exactly as the fixed journey runs it: read the time, press Start, hold on the live clock, Stop. */
const fixedSwitchTake = async (model: ModelPage) => {
    const pressedAt = Date.now();
    model.press();
    const take = await holdLiveTake(model.asPage(), SHORT_TAKE_SECONDS, pressedAt);
    model.stop();
    return take;
};

/** The switch take as main's journey ran it (rwtFocusPointsJourney.ts:1128-1130 on f2393a9e): 9 s from the click. */
const mainSwitchTake = async (model: ModelPage) => {
    model.press();
    await model.asPage().waitForTimeout(SHORT_TAKE_SECONDS * 1000);
    model.stop();
};

const run = async (take: Promise<unknown>) => {
    const done = take.then((v) => v);
    await vi.advanceTimersByTimeAsync(120_000);
    return done;
};

describe('#1882 — the switch take is held on the live clock', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T12:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    it('MECHANISM: main\'s click-timed take with capture live 4.5 s after the press is under five live seconds, and the rail is empty', async () => {
        const model = new ModelPage(4_500);
        await run(mainSwitchTake(model));
        console.log(`#1882_TEST_FIX ${JSON.stringify({ timing: 'click', pressToLiveMs: 4_500, liveSecondsAtStop: model.liveSecondsAtStop, tooShort: model.tooShort, railRows: model.railRows })}`);
        expect(model.liveSecondsAtStop).toBe(4.5);
        expect(model.tooShort).toBe(true);
        expect(model.railRows).toBe(0);
    });

    it.each([0, 1_500, 4_500, 9_800])('FIX: capture live %i ms after the press still gets the full live take and four rail rows', async (delay) => {
        const model = new ModelPage(delay);
        const take = await run(fixedSwitchTake(model)) as Awaited<ReturnType<typeof fixedSwitchTake>>;
        console.log(`#1882_TEST_FIX ${JSON.stringify({ timing: 'live', pressToLiveMs: take.pressToLiveMs, liveSecondsAtStop: model.liveSecondsAtStop, tooShort: model.tooShort, railRows: model.railRows })}`);
        // The live state is polled (50 ms in the model), so the reported delay is at most one poll late.
        expect(take.heldLiveSeconds).toBe(SHORT_TAKE_SECONDS);
        expect(take.pressToLiveMs).toBeGreaterThanOrEqual(delay);
        expect(take.pressToLiveMs).toBeLessThanOrEqual(delay + 50);
        // Never less than the intended live take; at most one poll more.
        expect(model.liveSecondsAtStop).toBeGreaterThanOrEqual(SHORT_TAKE_SECONDS);
        expect(model.liveSecondsAtStop).toBeLessThanOrEqual(SHORT_TAKE_SECONDS + 0.05);
        expect(model.tooShort).toBe(false);
        expect(model.railRows).toBe(4);
    });

    it('FIX: capture that never goes live returns at once with no live time, so the row reads the real outcome', async () => {
        const model = new ModelPage(null);
        const take = await run(fixedSwitchTake(model)) as Awaited<ReturnType<typeof fixedSwitchTake>>;
        expect(take).toEqual({ pressToLiveMs: null, heldLiveSeconds: 0 });
        expect(model.tooShort).toBe(true);
        expect(model.railRows).toBe(0);
    });

    it('rejects a non-positive hold', async () => {
        await expect(holdLiveTake(new ModelPage(0).asPage(), 0, Date.now())).rejects.toThrow(/INVALID_SETUP/);
    });
});

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
        const model = new ModelPage(0);
        expect(await readRailRowCount(model.asPage())).toBe(4);
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
