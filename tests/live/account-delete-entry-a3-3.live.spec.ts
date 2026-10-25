/**
 * A3-3.a on the DEPLOYED build — a signed-in person can find "Delete account" on the Account page.
 *
 * Read-only by construction: it signs in with the reusable Free account, opens /account, and asserts the plain link
 * below Membership points at /account/delete. It never follows the link — entering the deletion page signed in can
 * issue or acknowledge a completion capability (Sam 1792945860.963369) — and it never requests or confirms deletion.
 */
import { test, expect } from './helpers/deployedLiveTest';
import { goToPublicRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('A3-3.a Delete account entry on the deployed Account page', () => {
    const email = process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL ?? '';
    const password = process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD ?? '';

    test.beforeAll(() => {
        if (!email || !password) {
            throw new Error('Spec failed: FREE_TEST_EMAIL/FREE_TEST_PASSWORD are required for the Account entry check.');
        }
    });

    test('Account shows a plain "Delete account" link to /account/delete, and nothing follows it', async ({ page }) => {
        const closureCalls: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('account-closure')) closureCalls.push(request.method());
        });

        await goToPublicRoute(page, ROUTES.SIGN_IN);
        await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(email);
        await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(password);
        await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();
        await page.waitForURL(ROUTES.SESSION, { timeout: 30_000 });

        await page.goto('/account');
        const link = page.getByTestId('account-delete-link');
        await expect(link, 'the Delete account link is on the Account page').toBeVisible({ timeout: 20_000 });
        await expect(link).toHaveText('Delete account');
        await expect(link).toHaveAttribute('href', '/account/delete');

        // The page itself never talks to the closure service; only the deletion page (not visited here) does.
        expect(closureCalls, 'opening Account issues no account-closure request').toEqual([]);
    });
});
