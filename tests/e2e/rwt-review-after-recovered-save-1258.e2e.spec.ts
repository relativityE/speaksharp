/**
 * #1258 RWT round 2 C (live runs 38991376690 / 38991893303) — after a failed Stop and a SUCCESSFUL Retry Save, the
 * saved take was never reviewed: `verdict-practice-again` was not rendered within 120 s, so the person could not
 * practise again from the take they had just recovered. Only a successful Stop entered the review.
 *
 * Offline, with the existing mock engine and mock server: the first completion request is lost in the browser (as
 * the live request-lost case does), Stop fails, the recovery banner offers Retry Save, and the retry reaches the
 * server. The person must then see the same review a successful Stop shows, with `Practice this again` usable.
 * CONTROL: a Retry Save that fails again keeps the recovery and enters no review.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockLiveTranscript, navigateToRoute, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

/**
 * Loses the first `lose` take completions. The e2e build talks to the test-injected Supabase client on `window.supabase`
 * (`getSupabaseClient()` prefers it), not the network, so Playwright's routes never saw a completion and every save
 * succeeded. This wraps that client's `rpc` for `complete_session_v2` only: a lost completion returns the error a dropped
 * request produces, every later one reaches the mock unchanged, and every attempt is counted.
 */
async function loseCompletions(page: Page, lose: number): Promise<{ posts: () => Promise<number> }> {
    await page.waitForFunction(() => Boolean((window as unknown as { supabase?: unknown }).supabase));
    await page.evaluate((n) => {
        type Rpc = (fn: string, params?: unknown) => Promise<unknown>;
        const w = window as unknown as { supabase: { rpc: Rpc }; __lostCompletions__: { lose: number; posts: number } };
        w.__lostCompletions__ = { lose: n, posts: 0 };
        const original: Rpc = w.supabase.rpc.bind(w.supabase);
        w.supabase.rpc = (fn, params) => {
            if (fn !== 'complete_session_v2') return original(fn, params);
            w.__lostCompletions__.posts += 1;
            if (w.__lostCompletions__.lose > 0) {
                w.__lostCompletions__.lose -= 1;
                return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } });
            }
            return original(fn, params);
        };
    }, lose);
    return {
        posts: () => page.evaluate(() => (window as unknown as { __lostCompletions__: { posts: number } }).__lostCompletions__.posts),
    };
}

async function recordAndFailStop(page: Page, lose: number): Promise<{ posts: () => Promise<number> }> {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    const lost = await loseCompletions(page, lose);
    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(5_200); // past the sub-5 s no-persist guard: a genuinely completed take
    await stopRecording(page);
    await expect(page.getByTestId('session-unresolved-recovery'), 'the failed save offers recovery').toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('session-retry-save')).toBeVisible();
    await expect(page.getByTestId('verdict-practice-again'), 'precondition: a failed save shows no review').toHaveCount(0);
    expect(await lost.posts(), 'precondition: the take\'s completion was the request that was lost').toBe(1);
    return lost;
}

test.describe('#1258 RWT — a recovered save is reviewed like a saved one', () => {
    test('failed Stop → successful Retry Save → the review with Practice this again', async ({ page }) => {
        test.setTimeout(120_000);
        const lost = await recordAndFailStop(page, 1);

        await page.getByTestId('session-retry-save').click();
        await expect(page.getByTestId('session-unresolved-recovery'), 'the recovery resolves').toHaveCount(0, { timeout: 30_000 });
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
        await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]'), 'the page enters its review').toBeVisible({ timeout: 15_000 });
        const again = page.getByTestId('verdict-practice-again');
        await expect(again, 'the recovered take offers Practice this again').toBeVisible({ timeout: 15_000 });
        await expect(again).toBeEnabled({ timeout: 15_000 });
        expect(await lost.posts(), 'one lost completion and one recovered one').toBe(2);
        // The status bar visibly settles the failed save — never a stale failure or an endless "Finalizing…".
        const status = page.getByRole('main').getByRole('status').first();
        await expect(status, 'the status says the take is saved').toContainText('Session saved', { timeout: 15_000 });
        await expect(status).not.toContainText('Finalizing');

        // The repeat action really starts the next take.
        await again.click();
        await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    });

    test('CONTROL: a Retry Save that fails again keeps the recovery and enters no review', async ({ page }) => {
        test.setTimeout(120_000);
        await recordAndFailStop(page, 2);

        await page.getByTestId('session-retry-save').click();
        await page.waitForTimeout(3_000);
        await expect(page.getByTestId('session-unresolved-recovery'), 'the take is still recoverable').toBeVisible();
        await expect(page.getByTestId('session-retry-save')).toBeVisible();
        await expect(page.getByTestId('verdict-practice-again'), 'no review for an unsaved take').toHaveCount(0);
    });
});
