import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, attachLiveTranscript, waitForE2EEvent } from './helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('User Filler Words UI & Detection (Local)', () => {
    test.describe.configure({ mode: 'serial' }); // Serial mode to avoid state pollution

    test('should allow adding and removing filler words', async ({ userPage }) => {
        // 1. Navigate to Session
        await navigateToRoute(userPage, ROUTES.SESSION);

        // Ensure app settlement and bridge readiness
        await userPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        await userPage.waitForSelector('[data-testid="app-main"]', { timeout: 5000 });

        // 3. Wait for and scroll to Filler Words card
        const fillerCard = userPage.getByText('Filler Words', { exact: true }).first();
        await expect(fillerCard).toBeVisible({ timeout: 10000 });
        await fillerCard.scrollIntoViewIfNeeded();
        await userPage.waitForTimeout(500); // Allow scroll animation

        // 4. Open filler words popover using unique testid
        const settingsBtn = userPage.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 10000 });
        await settingsBtn.click();

        // 4. Wait for popover to open - check for the input placeholder from UserFillerWordsManager
        await expect(userPage.getByPlaceholder(/literally/i)).toBeVisible({ timeout: 10000 });

        // 5. Add a new word
        const word = 'AntigravityUI';
        const input = userPage.getByPlaceholder(/literally/i);
        await expect(input).toBeVisible();
        await input.fill(word);

        // Click the Add button (Plus icon)
        await userPage.getByRole('button', { name: /add word/i }).click();

        // 6. Wait for word to appear in the FillerWordsCard (popover closes after add)
        await userPage.waitForTimeout(1000); // Allow word to be added and popover to close

        // Verify word appears in the main FillerWordsCard below
        await expect(userPage.getByTestId('filler-words-list').getByText(word, { exact: false })).toBeVisible({ timeout: 10000 });

        // 7. Re-open popover to remove the word
        const settingsBtn2 = userPage.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn2).toBeVisible({ timeout: 5000 });
        await settingsBtn2.click();

        // Wait for popover to open again
        await expect(userPage.getByPlaceholder(/literally/i)).toBeVisible({ timeout: 5000 });

        // 8. Remove the word using aria-label in the popover
        const popoverContent = userPage.locator('[role="dialog"]').or(userPage.locator('.popover-content')).first();
        const removeBtn = popoverContent.getByRole('button', { name: new RegExp(`remove ${word}`, 'i') });
        await expect(removeBtn).toBeVisible({ timeout: 5000 });
        await removeBtn.click();

        // 9. Verify word is removed from popover list
        await expect(popoverContent.getByText(word, { exact: false })).not.toBeVisible();
    });

    test('should detect user filler words in transcript (Analysis)', async ({ userPage }) => {
        // This test proves that custom words are passed to the Analysis logic shared by Native/Private modes.

        // 2. Attach Bridge for Mock Speech Recognition (CRITICAL for Native Mode tests)
        await attachLiveTranscript(userPage);

        // 3. Navigate to Session
        await navigateToRoute(userPage, ROUTES.SESSION);

        // Ensure app settlement and bridge readiness
        await userPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // 4. Add custom word "detectiontest"
        const settingsBtn = userPage.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await settingsBtn.click();
        await userPage.getByPlaceholder(/literally/i).fill('detectiontest');
        await userPage.getByRole('button', { name: /add word/i }).click();

        // Wait for word to be added to FillerWordsCard (not popover)
        await expect(userPage.getByTestId('filler-words-list').getByText('detectiontest', { exact: false })).toBeVisible();

        await userPage.keyboard.press('Escape'); // Close settings

        // 5. Ensure Native Mode is selected
        const modeTrigger = userPage.getByTestId('stt-mode-select');
        if (await modeTrigger.isVisible()) {
            const currentMode = await modeTrigger.textContent();
            if (!currentMode?.includes('Native')) {
                await modeTrigger.click();
                await userPage.getByTestId('stt-mode-native').click();
            }
        }

        // 6. Start Session (Native Mode) and Wait for Bridge Ready
        // 6. Start Session (Native Mode)
        await userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // Wait for recording to be active
        await expect(userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true', { timeout: 10000 });

        // Evaluate to ensure speech recognition has been registered on window by the engine
        await userPage.waitForFunction(() => {
            const win = window as any;
            return win.dispatchMockTranscript !== undefined;
        }, null, { timeout: 10000 });

        // 6. Inject Transcript containing the custom word "detectiontest"
        await mockLiveTranscript(userPage, ['This is a detectiontest for antigravity.']);

        // 7. Assert "Filler Words" count increased (custom word detected)
        // Scroll to FillerWordsCard using test ID for reliability
        const fillerWordsCard = userPage.getByTestId('filler-words-list').locator('..'); // Get parent card
        await fillerWordsCard.scrollIntoViewIfNeeded();

        // Wait for filler detection to process
        await userPage.waitForTimeout(2000);

        // Use the reliable testid instead of badge text which can be flaky
        const fillerCountValue = userPage.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(fillerCountValue).not.toHaveText('0', { timeout: 10000 });
    });
});
