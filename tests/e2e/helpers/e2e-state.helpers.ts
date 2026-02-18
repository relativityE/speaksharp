import { Page } from '@playwright/test';

/**
 * E2E State Helpers
 * 
 * Provides utilities for deterministic testing by manipulating 
 * the application state directly through the E2E bridge.
 */

/**
 * Polls the session store state until a specific condition is met.
 * Useful for timing-sensitive assertions.
 */
export async function waitForStoreState<T>(
    page: Page,
    selector: (state: Record<string, unknown>) => T,
    expectedValue: T,
    options?: { timeout?: number; interval?: number }
): Promise<void> {
    const timeout = options?.timeout || 10000;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const result = await page.evaluate(({ selStr }: { selStr: string }) => {
            const win = window as unknown as { __SESSION_STORE_API__?: { getState: () => unknown } };
            const state = win.__SESSION_STORE_API__?.getState?.();
            if (!state) return null;
            try {
                const fn = new Function('state', `return (${selStr})(state)`);
                return fn(state);
            } catch (err) {
                console.error('Selector evaluation failed:', err);
                return null;
            }
        }, { selStr: selector.toString() });

        if (result === expectedValue) return;
        await page.waitForTimeout(options?.interval || 200);
    }
    throw new Error(`Timeout waiting for store state: ${selector.toString()}`);
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
 */
export async function setE2ETime(page: Page, seconds: number): Promise<void> {
    await page.evaluate((s) => {
        const win = window as unknown as { __SESSION_STORE_API__?: { setState: (s: unknown) => void } };
        const store = win.__SESSION_STORE_API__;
        if (store && store.setState) {
            store.setState({ elapsedTime: s });
        }
    }, seconds);
}
