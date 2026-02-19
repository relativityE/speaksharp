import { Page } from '@playwright/test';

/**
 * E2E State Helpers
 * 
 * Provides utilities for deterministic testing by manipulating 
 * the application state directly through the E2E bridge.
 */

import { expect } from '@playwright/test';

/**
 * Polls the session store state until a specific condition is met.
 * Useful for timing-sensitive assertions.
 *
 * ✅ INDUSTRY STANDARD: Uses Playwright's expect.toPass for durability.
 */
export async function waitForStoreState<T>(
    page: Page,
    selector: (state: unknown) => T,
    expectedValue: T,
    options?: { timeout?: number; interval?: number }
): Promise<void> {
    const timeout = options?.timeout || 10000;

    await expect(async () => {
        const result = await page.evaluate((selFuncStr) => {
            const win = window as unknown as { __SESSION_STORE_API__?: { getState: () => unknown } };
            const store = win.__SESSION_STORE_API__;
            if (!store) throw new Error('__SESSION_STORE_API__ not found in window');

            // Create a clean function from the string, stripping any TS artifacts
            // selFuncStr is expected to be a valid JS function string
            const sel = new Function('state', `return (${selFuncStr})(state)`);
            return sel(store.getState());
        }, selector.toString());

        expect(result).toBe(expectedValue);
    }).toPass({
        timeout,
        intervals: [options?.interval || 200]
    });
}

/**
 * Expose internal state to E2E context for verification
 */
export async function exposeStateForTesting(page: Page, key: string, value: unknown) {
    await page.evaluate(({ key, value }: { key: string; value: unknown }) => {
        const win = window as unknown as { __E2E_STATE__: Record<string, unknown> };
        win.__E2E_STATE__ = win.__E2E_STATE__ || {};
        win.__E2E_STATE__[key] = value;
    }, { key, value });
}

/**
 * Directly sets the elapsed time in the session store.
 * Allows for deterministic testing of duration-based tier limits.
 *
 * ✅ INDUSTRY STANDARD: Decouples state update from return to prevent evaluate hangs.
 */
export async function setE2ETime(page: Page, seconds: number): Promise<void> {
    await page.evaluate((s) => {
        const win = window as unknown as { __SESSION_STORE_API__?: { setState: (s: unknown) => void } };
        const store = win.__SESSION_STORE_API__;
        if (store && store.setState) {
            store.setState({
                elapsedTime: s,
                startTime: Date.now() - (s * 1000)
            });
        }
    }, seconds);
}

/**
 * Clears the React Query cache via the E2E bridge.
 * Useful after changing mocks to ensure the app fetches fresh data.
 */
export async function clearQueryCache(page: Page): Promise<void> {
    // Wait for the app to initialize the queryClient
    await page.waitForFunction(() => (window as unknown as { queryClient?: unknown }).queryClient !== undefined, { timeout: 10000 });

    await page.evaluate(() => {
        const win = window as unknown as { queryClient?: { clear: () => void; invalidateQueries: () => void } };
        if (win.queryClient && typeof win.queryClient.clear === 'function') {
            console.log('[E2E Help] Clearing Query Cache...');
            win.queryClient.clear();
            // Also invalidate to be sure
            if (typeof win.queryClient.invalidateQueries === 'function') {
                win.queryClient.invalidateQueries();
            }
        }
    });
}
