import { test, expect, type Page } from '@playwright/test';
import { goToPublicRoute, navigateToRoute } from '../e2e/helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('Live user filler words persistence', () => {
    test.beforeAll(() => {
        if (process.env.VITE_USE_LIVE_DB !== 'true') {
            console.warn('Skipping live custom words persistence test: VITE_USE_LIVE_DB=true is not set.');
            test.skip();
            return;
        }

        if (!(process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL) || !(process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD)) {
            throw new Error('Spec failed: BASIC_TEST_EMAIL/BASIC_TEST_PASSWORD are required for live custom words persistence. E2E_BASIC_EMAIL/E2E_BASIC_PASSWORD remain supported as legacy local aliases.');
        }
    });

    const email = process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL ?? '';
    const password = process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD ?? '';

    async function signIn(page: Page) {
        await goToPublicRoute(page, ROUTES.SIGN_IN);
        await page.getByTestId(TEST_IDS.EMAIL_INPUT).fill(email);
        await page.getByTestId(TEST_IDS.PASSWORD_INPUT).fill(password);
        await page.getByTestId(TEST_IDS.SIGN_IN_SUBMIT).click();
        await page.waitForURL(ROUTES.SESSION, { timeout: 30000 });
        await expect(page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON)).toBeVisible({ timeout: 15000 });
    }

    async function openCustomWords(page: Page) {
        await navigateToRoute(page, ROUTES.SESSION);
        const settingsButton = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsButton).toBeVisible({ timeout: 15000 });
        await settingsButton.click();
        await expect(page.getByTestId(TEST_IDS.USER_FILLER_WORDS_INPUT)).toBeVisible({ timeout: 10000 });
    }

    test('persists custom words across logout and login', async ({ page }) => {
        const word = `persist${Date.now()}`;

        await signIn(page);
        await openCustomWords(page);

        const addResponse = page.waitForResponse(response =>
            response.request().method() === 'POST' &&
            response.url().includes('/rest/v1/user_filler_words') &&
            response.status() >= 200 &&
            response.status() < 300
        );
        await page.getByTestId(TEST_IDS.USER_FILLER_WORDS_INPUT).fill(word);
        await page.getByTestId('user-filler-words-add-button').click();
        await addResponse;
        await openCustomWords(page);
        await expect(page.getByTestId('filler-word-badge').filter({ hasText: word })).toBeVisible({ timeout: 10000 });

        await page.keyboard.press('Escape');
        await page.getByTestId(TEST_IDS.NAV_SIGN_OUT_BUTTON).click();

        await signIn(page);
        await openCustomWords(page);
        await expect(page.getByTestId('filler-word-badge').filter({ hasText: word })).toBeVisible({ timeout: 10000 });

        await page.getByRole('button', { name: new RegExp(`remove ${word}`, 'i') }).click();
        await expect(page.getByTestId('filler-word-badge').filter({ hasText: word })).toBeHidden({ timeout: 10000 });
    });
});
