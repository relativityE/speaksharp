import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, attachLiveTranscript, waitForE2EEvent, waitForModelReady } from './helpers';
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

        // 3. Wait for and scroll to the filler words card. #1047: before any recording the card is
        //    COLLAPSED to a single tracking summary — the "Detected filler words" heading and the chip
        //    grid belong to the expanded state, which is only reached once real counts exist. Assert the
        //    pre-session surface that actually ships.
        const fillerCard = userPage.getByTestId('filler-words-card');
        await expect(fillerCard).toHaveAttribute('data-filler-state', 'before-recording', { timeout: 10000 });
        // The card keeps a stable accessible name in every state, including the collapsed ones.
        await expect(userPage.getByRole('region', { name: 'Detected filler words' })).toBeVisible();
        const trackingSummary = userPage.getByTestId('filler-tracking-summary');
        await expect(trackingSummary).toBeVisible({ timeout: 10000 });
        await fillerCard.scrollIntoViewIfNeeded();

        // The count is derived from the tracked-word list, so capture it to prove the add moves it.
        const summaryBefore = await trackingSummary.innerText();

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

        // 6. #1047: the popover now STAYS OPEN, and that is the confirmation. With the pre-session chip
        //    grid collapsed there is nowhere else the new word could appear, so closing immediately
        //    would have left the user with no evidence their word was accepted. The word must show up
        //    in the manager's own list, in front of them.
        await expect(userPage.getByPlaceholder(/literally/i)).toBeVisible({ timeout: 10000 });
        await expect(
            userPage.getByTestId('filler-word-badge').filter({ hasText: word })
        ).toBeVisible({ timeout: 10000 });

        // …and the collapsed card's derived tracking count moves, proving the word reached the tracked
        // list rather than only the popover's local state.
        await expect(userPage.getByTestId('filler-tracking-summary')).not.toHaveText(summaryBefore, { timeout: 10000 });

        // 8. Remove the word using aria-label in the popover (already open).
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

        // 4. Verification: the word is accepted into the tracked list. #1047: pre-session the chip grid
        //    is collapsed, so confirmation is the manager's own list (which stays open on add). The
        //    grid assertion belongs after speech, at the end of this test, where a real count exists.
        await expect(
            userPage.getByTestId('filler-word-badge').filter({ hasText: 'detectiontest' })
        ).toBeVisible({ timeout: 10000 });

        await userPage.keyboard.press('Escape'); // Close settings

        // 5. Ensure Native Mode is selected
        // Forensic Readiness Gate (Invariant I3)
        await waitForModelReady(userPage, 15000);

        const modeTrigger = userPage.getByTestId(TEST_IDS.STT_MODE_SELECT);
        if (await modeTrigger.isVisible()) {
            const currentMode = await modeTrigger.getAttribute('data-state');
            if (currentMode !== 'native') {
                const bboxFW = await modeTrigger.boundingBox();
                if (bboxFW) {
                    await userPage.mouse.click(bboxFW.x + bboxFW.width / 2, bboxFW.y + bboxFW.height / 2);
                } else {
                    await modeTrigger.click({ force: true });
                }
                await userPage.getByRole('menuitemradio', { name: /Native/i }).click();
            }
        }

        // 6. Start Session (Native Mode) and Wait for Bridge Ready
        // Use Promise.all to setup listener BEFORE triggering the action that causes the event
        await Promise.all([
            waitForE2EEvent(userPage, 'e2e:speech-recognition-ready'),
            userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click()
        ]);

        await expect(userPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true', { timeout: 10000 });

        // 6. Inject Transcript containing the custom word "detectiontest"
        await mockLiveTranscript(userPage, ['This is a detectiontest for antigravity.']);

        // 7. Assert "Filler Words" count increased (custom word detected). The transcript above contains
        //    the custom word, so a real count now exists and the card EXPANDS to the chip grid — the
        //    custom word is visible there, on the evidence it actually produced.
        const fillerWordsCard = userPage.getByTestId('filler-words-card');
        await expect(fillerWordsCard).toHaveAttribute('data-filler-state', 'counts', { timeout: 10000 });
        await fillerWordsCard.scrollIntoViewIfNeeded();
        await expect(
            userPage.getByTestId('filler-words-list').getByText('detectiontest', { exact: false })
        ).toBeVisible({ timeout: 10000 });

        // Verification of asynchronous filler detection count
        // The following assertion with generous timeout replaces the fixed delay.

        // Use the reliable testid instead of badge text which can be flaky
        const fillerCountValue = userPage.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(fillerCountValue).not.toHaveText('0', { timeout: 10000 });
    });
});
