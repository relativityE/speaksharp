import { test, expect } from './fixtures';
import {
  navigateToRoute,
  mockLiveTranscript,
  attachLiveTranscript,
  startRecording,
  stopRecording,
} from './helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('User Filler Words UI & Detection (Local)', () => {
    test.describe.configure({ mode: 'serial' }); // Serial mode to avoid state pollution

    test('should allow adding and removing filler words', async ({ userPage }) => {
        // 1. Navigate to Session
        await navigateToRoute(userPage, ROUTES.SESSION);

        // Ensure app settlement and bridge readiness
        await userPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        await userPage.waitForSelector('[data-testid="nav-sign-out-button"]', { timeout: 5000 });

        // 2. #1231: the custom-word manager lives in the after-state FillerBreakdown, reached via the
        //    `add-custom-word-button` popover. Record a short session to reach the after-state first.
        await startRecording(userPage);
        await mockLiveTranscript(userPage, ['A short session to reach the review state.']);
        await userPage.waitForTimeout(5200); // clear the sub-5s no-persist guard
        await stopRecording(userPage);

        // 3. Open the custom filler words popover (after-state manager trigger).
        const settingsBtn = userPage.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 15000 });
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

        // 6. #1047: the popover STAYS OPEN, and that is the confirmation — the new word must show up in the
        //    manager's own list, in front of the user.
        await expect(userPage.getByPlaceholder(/literally/i)).toBeVisible({ timeout: 10000 });
        await expect(
            userPage.getByTestId('filler-word-badge').filter({ hasText: word })
        ).toBeVisible({ timeout: 10000 });

        // 7. Remove the word using aria-label in the popover (already open).
        const popoverContent = userPage.locator('[role="dialog"]').or(userPage.locator('.popover-content')).first();
        const removeBtn = popoverContent.getByRole('button', { name: new RegExp(`remove ${word}`, 'i') });
        await expect(removeBtn).toBeVisible({ timeout: 5000 });
        await removeBtn.click();

        // 8. Verify word is removed from popover list
        await expect(popoverContent.getByText(word, { exact: false })).not.toBeVisible();
    });

    test('should detect user filler words in transcript (Analysis)', async ({ userPage }) => {
        // This test proves that custom words are passed to the Analysis logic used by the Private path.

        // 1. Attach Bridge for Mock Speech Recognition logging.
        await attachLiveTranscript(userPage);

        // 2. Navigate to Session
        await navigateToRoute(userPage, ROUTES.SESSION);

        // Ensure app settlement and bridge readiness
        await userPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // 3. #1231: reach the after-state (custom-word manager only exists there) via a short throwaway
        //    session, then add the custom word "detectiontest".
        await startRecording(userPage);
        await mockLiveTranscript(userPage, ['A short session to reach the review state.']);
        await userPage.waitForTimeout(5200);
        await stopRecording(userPage);

        const settingsBtn = userPage.getByTestId(TEST_IDS.SESSION_SETTINGS_BUTTON);
        await expect(settingsBtn).toBeVisible({ timeout: 15000 });
        await settingsBtn.click();
        await userPage.getByPlaceholder(/literally/i).fill('detectiontest');
        await userPage.getByRole('button', { name: /add word/i }).click();

        // 4. Verification: the word is accepted into the tracked list (manager stays open on add).
        await expect(
            userPage.getByTestId('filler-word-badge').filter({ hasText: 'detectiontest' })
        ).toBeVisible({ timeout: 10000 });

        await userPage.keyboard.press('Escape'); // Close popover

        // 5. #1231: the custom-word manager lives in the after-state, so adding the word left us in the
        //    review state (no `mic-start`). Reset to a fresh before-state — the tracked word persists
        //    across the reload (it is saved to `user_filler_words`) so the NEXT session's analysis counts
        //    it. This mirrors the origin/main flow (word tracked BEFORE the analysed recording), which the
        //    after-state-only manager otherwise can't express in a single load.
        await navigateToRoute(userPage, ROUTES.SESSION);
        await userPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // 6. Record a session whose transcript contains the custom word, so it produces a real count.
        await startRecording(userPage);
        await mockLiveTranscript(userPage, ['This is a detectiontest for antigravity.']);
        await userPage.waitForTimeout(5200);
        await stopRecording(userPage);

        // 6. The after-state per-word breakdown lists the custom word with a real (non-zero) count. The
        //    `data-word` attribute lives on the `filler-breakdown-word` element itself.
        await expect(userPage.getByTestId('filler-breakdown')).toBeVisible({ timeout: 15000 });
        const customWord = userPage.locator('[data-testid="filler-breakdown-word"][data-word="detectiontest"]');
        await expect(customWord).toBeVisible({ timeout: 15000 });
        await expect(customWord.getByTestId('filler-breakdown-count')).not.toHaveText('×0');
    });
});
