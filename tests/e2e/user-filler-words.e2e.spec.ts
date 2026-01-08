import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript, attachLiveTranscript } from './helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('User Filler Words UI & Detection (Local)', () => {
    test.describe.configure({ mode: 'serial' }); // Serial mode to avoid state pollution

    test('should allow adding and removing filler words', async ({ page }) => {
        // 1. Mock Login
        await programmaticLoginWithRoutes(page);

        // 2. Navigate to Session
        await navigateToRoute(page, ROUTES.SESSION);

        // 3. Open settings sheet
        const settingsBtn = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible();
        await settingsBtn.click();

        // 4. Wait for Sheet to open
        await expect(page.getByText('Session Settings')).toBeVisible();
        await expect(page.getByText('User Filler Words')).toBeVisible({ timeout: 10000 });

        // 5. Add a new word
        const word = 'AntigravityUI';
        // Relaxed placeholder check to match partial or main part
        const input = page.getByPlaceholder(/literally/i);
        await expect(input).toBeVisible();
        await input.fill(word);

        await page.getByRole('button', { name: /add word/i }).click();

        // 6. Verify word appears (Robust Check)
        // Check for exact element containing the text, case-insensitive logic handled by App display
        // or check just strict text presence, waiting if needed.
        // The word added is 'AntigravityUI'. App typically displays as-is.
        const wordLocator = page.getByText(word, { exact: false });
        await expect(wordLocator).toBeVisible({ timeout: 10000 });

        // 7. Remove the word
        // Selector relies on aria-label or text. The valid aria-label is `Remove <word>`.
        // We use RegExp to be safe about spacing/casing.
        const removeBtn = page.getByRole('button', { name: new RegExp(`remove ${word}`, 'i') });
        await expect(removeBtn).toBeVisible();
        await removeBtn.click();

        // 8. Verify word is removed
        await expect(wordLocator).not.toBeVisible();
    });

    test('should detect user filler words in transcript (Analysis)', async ({ page }) => {
        // This test proves that custom words are passed to the Analysis logic shared by Native/Private modes.

        // 1. Mock Login
        await programmaticLoginWithRoutes(page);

        // 2. Attach Bridge for Mock Speech Recognition (CRITICAL for Native Mode tests)
        await attachLiveTranscript(page);

        // 3. Navigate to Session
        await navigateToRoute(page, ROUTES.SESSION);

        // 4. Add custom word "detectiontest"
        const settingsBtn = page.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await settingsBtn.click();
        await page.getByPlaceholder(/literally/i).fill('detectiontest');
        await page.getByRole('button', { name: /add word/i }).click();

        // Wait for word to be accepted and rendered to ensure state is synced
        await expect(page.getByText('detectiontest', { exact: false })).toBeVisible();

        await page.keyboard.press('Escape'); // Close settings

        // 5. Start Session (Native Mode default)
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        await expect(page.getByText('Listening...')).toBeVisible();

        // 6. Inject Transcript containing the custom word "detectiontest"
        await mockLiveTranscript(page, ['This is a detectiontest for antigravity.']);

        // 7. Assert "Filler Words" count increased (custom word detected)
        // Wait for filler detection to process
        await page.waitForTimeout(1500);
        // Use the reliable testid instead of badge text which can be flaky
        const fillerCountValue = page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(fillerCountValue).not.toHaveText('0', { timeout: 10000 });
        console.log('[TEST] ✅ Custom filler word detected');
    });
});
