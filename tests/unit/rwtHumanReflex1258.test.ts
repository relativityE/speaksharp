// @vitest-environment node
/**
 * #1258 PO 2026-10-12 — the RWT journeys model a PERSON. Alpha runs 38298685079 and 38304068207 pressed the review's
 * repeat action 97 ms and 87 ms after Stop; a person takes longer. Every RWT action now waits a human think-time first:
 * 500 ms by default, 1000 ms only when 500 still fails. 250 ms is reserved for later and is not offered.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
    DEFAULT_HUMAN_REFLEX_MS, HUMAN_REFLEX_CHOICES, activeHumanReflexMs, applyHumanReflex, resolveHumanReflexMs,
} from '../live/helpers/rwtHumanReflex';
import { RwtReceipt } from '../live/helpers/rwtJourney';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('resolveHumanReflexMs — 500 or 1000, nothing else', () => {
    it('defaults to 500 when the dispatch leaves it empty', () => {
        expect(DEFAULT_HUMAN_REFLEX_MS).toBe(500);
        expect(resolveHumanReflexMs(undefined)).toBe(500);
        expect(resolveHumanReflexMs('')).toBe(500);
        expect(resolveHumanReflexMs('500')).toBe(500);
        expect(resolveHumanReflexMs('1000')).toBe(1000);
    });
    it('refuses 250 (reserved for later), 0 and anything unparseable', () => {
        expect([...HUMAN_REFLEX_CHOICES]).toEqual([500, 1000]);
        for (const bad of ['250', '0', '-500', '750', 'fast']) expect(() => resolveHumanReflexMs(bad)).toThrow(/RWT_HUMAN_REFLEX_MS/);
    });
});

describe('applyHumanReflex — every action waits, and only while applied', () => {
    afterEach(() => { vi.useRealTimers(); });

    class FakeLocator { calls: string[] = []; async click() { this.calls.push('click'); } async fill() { this.calls.push('fill'); } async isVisible() { this.calls.push('isVisible'); return true; } }
    class FakeKeyboard { calls: string[] = []; async press() { this.calls.push('press'); } }
    const locator = new FakeLocator();
    const keyboard = new FakeKeyboard();
    const page = { locator: () => locator, keyboard } as unknown as Page;

    it('a press starts only after the think-time, a read does not wait, and release removes the wait', async () => {
        vi.useFakeTimers();
        const release = applyHumanReflex(page, 500);
        expect(activeHumanReflexMs()).toBe(500);

        const click = locator.click();
        await vi.advanceTimersByTimeAsync(499);
        expect(locator.calls).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await click;
        expect(locator.calls).toEqual(['click']);

        await locator.isVisible();
        expect(locator.calls).toEqual(['click', 'isVisible']);

        const key = keyboard.press();
        await vi.advanceTimersByTimeAsync(500);
        await key;
        expect(keyboard.calls).toEqual(['press']);

        release();
        expect(activeHumanReflexMs()).toBe(0);
        await locator.fill();
        expect(locator.calls).toEqual(['click', 'isVisible', 'fill']);
    });

    it('applying twice wraps once: one think-time per action, not two', async () => {
        vi.useFakeTimers();
        applyHumanReflex(page, 1000);
        const release = applyHumanReflex(page, 1000);
        locator.calls.length = 0;
        const click = locator.click();
        await vi.advanceTimersByTimeAsync(1000);
        await click;
        expect(locator.calls).toEqual(['click']);
        release();
    });

    it('the receipt records the think-time it ran with', () => {
        const release = applyHumanReflex(page, 1000);
        expect(new RwtReceipt('unit').meta.humanReflexMs).toBe(1000);
        release();
        expect(new RwtReceipt('unit').meta.humanReflexMs).toBe(0);
    });
});

describe('every RWT scenario runs with it, and the dispatch can choose it', () => {
    it('all six RWT specs (the seven scenarios) use the RWT production base that applies the think-time', () => {
        const live = path.join(ROOT, 'tests/live');
        const specs = readdirSync(live).filter((f) => /^rwt-.*\.live\.spec\.ts$/.test(f));
        expect(specs.length).toBe(6);
        for (const spec of specs) {
            const src = readFileSync(path.join(live, spec), 'utf8');
            expect({ spec, usesRwtBase: /from '\.\/helpers\/rwtProductionTest'/.test(src) }).toEqual({ spec, usesRwtBase: true });
        }
        const base = readFileSync(path.join(live, 'helpers/rwtProductionTest.ts'), 'utf8');
        expect(base).toMatch(/applyHumanReflex\(page, resolveHumanReflexMs\(\)\)/);
    });

    it('rc-gates.yml offers exactly 500 and 1000 (default 500) and passes the choice to the spec', () => {
        const wf = readFileSync(path.join(ROOT, '.github/workflows/rc-gates.yml'), 'utf8');
        const input = wf.match(/ {6}rwt_human_reflex_ms:\n([\s\S]*?)\n(?: {6}[a-z_]+:\n|\n)/);
        expect(input).not.toBeNull();
        expect(input![1]).toMatch(/default: '500'/);
        expect(input![1]).toMatch(/type: choice/);
        expect([...input![1].matchAll(/^ {10}- '(\d+)'$/gm)].map((m) => m[1])).toEqual(['500', '1000']);
        expect(wf).toContain('RWT_HUMAN_REFLEX_MS: ${{ github.event.inputs.rwt_human_reflex_ms }}');
    });
});
