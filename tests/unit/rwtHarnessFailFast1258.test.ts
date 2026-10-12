// @vitest-environment node
/**
 * #1258 PM 6132878919 — alpha run 38304068207 hung for 32 minutes: the next Start failed, the page was torn down to
 * about:blank, and the Focus-only product-switch step waited forever for a menu on that blank page (the deployed-live
 * config bounds no action). The harness now bounds every action and navigation, and a step that drives the current
 * page stops the journey at once on a torn-down page. The receipt and cleanup still run (the spec's `finally`), and the
 * verdict stays FAIL.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';

const soft = vi.hoisted(() => ({ calls: [] as Array<{ actual: unknown; message?: string }> }));
vi.mock('@playwright/test', () => {
    const expect = Object.assign(() => ({ toBe: () => undefined }), {
        soft: (actual: unknown, message?: string) => { soft.calls.push({ actual, message }); return { toBe: () => undefined }; },
    });
    return { expect, test: {} };
});
import { JOURNEY_STOPPED_ROW, RwtJourneyStopped, RwtReceipt, stopIfPageTornDown } from '../live/helpers/rwtJourney';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fakePage = (url: string, closed = false) => ({ url: () => url, isClosed: () => closed }) as unknown as Page;

describe('stopIfPageTornDown — a torn-down page stops the journey with a FAIL row', () => {
    afterEach(() => { soft.calls.length = 0; });

    it('about:blank (left by boundedTeardown) records one FAIL row and throws RwtJourneyStopped', () => {
        const receipt = new RwtReceipt('unit');
        expect(() => stopIfPageTornDown(receipt, fakePage('about:blank'), 'next Start without a hold', 'product switch'))
            .toThrow(RwtJourneyStopped);
        expect(receipt.rows).toHaveLength(1);
        expect(receipt.rows[0]).toMatchObject({
            step: JOURNEY_STOPPED_ROW, verdict: 'FAIL',
            evidence: { afterStep: 'next Start without a hold', nextStep: 'product switch' },
        });
        expect(soft.calls.some((c) => c.actual === 'FAIL' && String(c.message).startsWith(`${JOURNEY_STOPPED_ROW}:`))).toBe(true);
    });

    it('a closed page stops the same way', () => {
        const receipt = new RwtReceipt('unit');
        expect(() => stopIfPageTornDown(receipt, fakePage('https://speaksharp-public.vercel.app/session', true), 'a', 'b'))
            .toThrow(RwtJourneyStopped);
        expect(receipt.rows.map((r) => r.verdict)).toEqual(['FAIL']);
    });

    it('a live page continues: no row, no throw', () => {
        const receipt = new RwtReceipt('unit');
        expect(() => stopIfPageTornDown(receipt, fakePage('https://speaksharp-public.vercel.app/session'), 'a', 'b')).not.toThrow();
        expect(receipt.rows).toEqual([]);
        expect(soft.calls).toEqual([]);
    });
});

describe('wiring — the hang site is guarded, the stop reaches finally, and actions are bounded', () => {
    const focus = readFileSync(path.join(ROOT, 'tests/live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    const base = readFileSync(path.join(ROOT, 'tests/live/helpers/rwtProductionTest.ts'), 'utf8');

    it('the Focus product-switch step (the 38304068207 hang) is preceded by the guard, after the next Start', () => {
        const nextStart = focus.indexOf("test.step('next Start without a hold'");
        const guard = focus.indexOf('stopIfPageTornDown(receipt, page');
        const productSwitch = focus.indexOf("test.step('Open Mic take, then a Focus take right after the product switch'");
        expect(nextStart).toBeGreaterThan(0);
        expect(guard).toBeGreaterThan(nextStart);
        expect(productSwitch).toBeGreaterThan(guard);
    });

    it('the guarded steps run inside the journey try whose finally writes the receipt and runs cleanup', () => {
        const guard = focus.indexOf('stopIfPageTornDown(receipt, page');
        const tryAt = focus.lastIndexOf('    try {', guard);
        const finallyAt = focus.indexOf('    } finally {', guard);
        expect(tryAt).toBeGreaterThan(0);
        expect(finallyAt).toBeGreaterThan(guard);
        const tail = focus.slice(finallyAt);
        expect(tail).toMatch(/cleanupRunOwnedAccount/);
        expect(tail).toMatch(/receipt\.write\(/);
    });

    it('every RWT action and navigation without its own timeout is bounded well inside the shortest test timeout', () => {
        expect(base).toMatch(/context\.setDefaultTimeout\(RWT_ACTION_TIMEOUT_MS\)/);
        expect(base).toMatch(/context\.setDefaultNavigationTimeout\(RWT_ACTION_TIMEOUT_MS\)/);
        const ms = Number(base.match(/RWT_ACTION_TIMEOUT_MS = ([\d_]+)/)?.[1].replace(/_/g, ''));
        expect(ms).toBe(90_000);
        expect(ms).toBeLessThan(5 * 60_000); // the shortest RWT test timeout (Products navigation, 5 min)
    });
});
