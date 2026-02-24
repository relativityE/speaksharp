import { test, expect } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { enableTestRegistry } from '../helpers/testRegistry.helpers';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

/**
 * SpeakSharp: Phase 6 - CI Drift Detection
 * 🔍 Objective: Ensure Frontend Mock Assumptions match Backend Realities.
 */

const GET_STORE_STATE = `(() => {
    const store = window.__SESSION_STORE_API__ || window.useSessionStore;
    return store && store.getState ? store.getState() : {};
})()`;

test.describe('Contract Preservation: CI Drift Detection', () => {

    test.beforeEach(async ({ page }) => {
        await setupE2EMocks(page);
        await enableTestRegistry(page);
        await programmaticLoginWithRoutes(page);
    });

    test('should validate that the STT Engine signatures match expected contracts', async ({ page }) => {
        await navigateToRoute(page, '/session');

        const storeState = await page.evaluate(GET_STORE_STATE) as Record<string, unknown>;

        const expectedKeys = ['sttStatus', 'activeEngine', 'transcript', 'sttMode', 'fillerData'];
        expectedKeys.forEach(key => {
            expect(storeState).toHaveProperty(key);
        });
    });

    test('should verify that store updates are observable via E2E bridge', async ({ page }) => {
        await navigateToRoute(page, '/session');

        await page.evaluate(`(() => {
            const store = window.__SESSION_STORE_API__ || window.useSessionStore;
            if (store && store.getState().updateTranscript) {
                store.getState().updateTranscript('Hello test world', '');
                store.getState().setElapsedTime(10);
            }
        })()`);

        const storeState = await page.evaluate(GET_STORE_STATE) as Record<string, unknown>;
        const transcript = storeState.transcript as Record<string, unknown> | undefined;

        expect(transcript?.transcript).toBe('Hello test world');
        expect(storeState.elapsedTime).toBe(10);
    });
});
