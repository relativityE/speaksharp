// @vitest-environment node
/**
 * #1258 harness successor (PM 6134479029) — regressions for the alpha-baseline oracle drift and harness defects:
 * minute-format pace guide (R5), numbered rail labels (R6) and a missing coaching card (R3b). Delayed-header (R4) and
 * fatal-stop/cleanup (R3) are pinned in rwtHarnessFailFast1258.test.ts; the R7 tolerance in rwtCorpusTolerance1258.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Locator } from '@playwright/test';

vi.mock('@playwright/test', () => ({ expect: Object.assign(() => ({}), { soft: () => ({ toBe: () => undefined }) }), test: {} }));
import { readCoachingPhrase, sameOrderedPendingSet } from '../live/helpers/rwtJourney';
import { PACE_GUIDE_DEFAULT_SECONDS, parsePaceGuideSeconds } from '../live/helpers/rwtPaceGuide';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('R5 — the pace guide is minutes per point, compared as seconds', () => {
    it('the shipped default "1 min" is 60 s, and half-minute steps read exactly', () => {
        expect(PACE_GUIDE_DEFAULT_SECONDS).toBe(60);
        expect(parsePaceGuideSeconds('1 min')).toBe(60);
        expect(parsePaceGuideSeconds('0.5 min')).toBe(30);
        expect(parsePaceGuideSeconds('1.5 min')).toBe(90);
        expect(parsePaceGuideSeconds(' 3 MIN ')).toBe(180);
    });
    it('anything that is not a minutes value is null, never a guess (a skipped or missing guide included)', () => {
        for (const text of ['', null, undefined, '1:00', 'min', '0 min', 'about 1 min', '1 min per point']) {
            expect(parsePaceGuideSeconds(text)).toBeNull();
        }
    });
    it('the product still renders minutes, and the journey reads the guide with the minutes parser', () => {
        expect(read('frontend/src/components/session/ObjectiveSetupForm.tsx')).toMatch(/data-testid="objective-pace-value"[^>]*>\{fmtMin\(paceGuideMin\)\} min</);
        const journey = read('tests/live/helpers/rwtFocusPointsJourney.ts');
        expect(journey).toMatch(/parsePaceGuideSeconds\(await paceValue\.innerText\(\{ timeout: 5_000 \}\)/);
        expect(journey).not.toMatch(/parseClock\(await page\.getByTestId\('objective-pace-value'\)/);
    });
});

describe('R6 — the reopened set is compared by label, order, count and pending status', () => {
    const points = ['Open with the problem', 'Name the cost', 'Offer the fix'];
    const pending = ['pending', 'pending', 'pending'];
    it('the same labels in order, all pending, is the same set', () => {
        expect(sameOrderedPendingSet(points, pending, points)).toBe(true);
    });
    it('whole-row text that starts with the numbered marker is NOT a label (the 38304068207 oracle drift)', () => {
        expect(sameOrderedPendingSet(points.map((p, i) => `${i + 1}\n${p}`), pending, points)).toBe(false);
    });
    it('order, count and every pending status still matter', () => {
        expect(sameOrderedPendingSet([points[1], points[0], points[2]], pending, points)).toBe(false);
        expect(sameOrderedPendingSet(points.slice(0, 2), pending.slice(0, 2), points)).toBe(false);
        expect(sameOrderedPendingSet(points, ['pending', 'covered', 'pending'], points)).toBe(false);
        expect(sameOrderedPendingSet(points, ['pending', null, 'pending'], points)).toBe(false);
    });
    it('the rail row draws a number before its label, and the helper reads the label paragraph', () => {
        expect(read('frontend/src/components/session/FocusPointsRail.tsx')).toMatch(/String\(index \+ 1\)/);
        expect(read('tests/live/helpers/rwtJourney.ts')).toMatch(/rows\.map\(\(r\) => r\.locator\('p'\)\.first\(\)\.innerText\(\{ timeout: 5_000 \}\)/);
    });
});

describe('R3b — a coaching phrase is read by its test id, bounded', () => {
    const fake = (count: number, innerText: () => Promise<string>) => ({
        getByTestId: () => ({ first: () => ({ count: async () => count, innerText }) }),
    }) as unknown as Locator;
    it('a missing card phrase is "" immediately, not a wait', async () => {
        const innerText = vi.fn(async () => 'never read');
        expect(await readCoachingPhrase(fake(0, innerText), 'review-what-went-well')).toBe('');
        expect(innerText).not.toHaveBeenCalled();
    });
    it('a read that fails within its bound is "", and a present phrase is trimmed', async () => {
        expect(await readCoachingPhrase(fake(1, async () => { throw new Error('Timeout 5000ms exceeded'); }), 'review-try-next')).toBe('');
        expect(await readCoachingPhrase(fake(1, async () => '  Slow down at the close.  '), 'review-try-next')).toBe('Slow down at the close.');
    });
    it('the shared review pair owns both ids, and the Focus reader no longer walks headings', () => {
        const pair = read('frontend/src/components/review/PracticeLoopReviewPair.tsx');
        expect(pair).toContain('data-testid="review-what-went-well"');
        expect(pair).toContain('data-testid="review-try-next"');
        const journey = read('tests/live/helpers/rwtJourney.ts');
        expect(journey).toMatch(/node\.innerText\(\{ timeout: COACHING_PHRASE_READ_MS \}\)/);
        expect(journey).not.toMatch(/card\.locator\('div', \{ has: title \}\)/);
    });
});
