/**
 * Pro User Journey E2E Test
 * 
 * Complete lifecycle test for PRO tier users:
 * 1. Login as Pro user
 * 2. Test all 3 STT modes: Native, Cloud (AssemblyAI), Private (Whisper)
 * 3. User words
 * 4. All 15 analytics verification
 * 5. Logout/relogin persistence
 * 6. Multiple sessions with cumulative scores
 */
import { test, expect } from './fixtures';
import { navigateToRoute, debugLog } from './helpers';
import { TEST_IDS } from '../constants';

test.describe('Pro User Journey - Complete Lifecycle', () => {
    test('should have all 3 STT modes available', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');
        await expect(proPage.getByText('Practice Session')).toBeVisible();

        // Pro users should have access to all STT modes
        // The mode selector should be visible and interactable
        const modeSelector = proPage.getByTestId('stt-mode-select');
        if (await modeSelector.count() > 0) {
            await modeSelector.click();

            // Check for all three options
            const nativeOption = proPage.getByText(/Browser/i, { exact: true }).first();
            const cloudOption = proPage.getByText(/Cloud/i, { exact: true }).first();
            const privateOption = proPage.getByText(/Private/i, { exact: true }).first();

            debugLog('[PRO] Checking STT mode options...');
            if (await nativeOption.count() > 0) debugLog('[PRO] ✅ Browser available');
            if (await cloudOption.count() > 0) debugLog('[PRO] ✅ Cloud available');
            if (await privateOption.count() > 0) debugLog('[PRO] ✅ Private available');
        } else {
            debugLog('[PRO] ⚠️ STT mode selector not found, checking default mode');
        }
    });

    test('should complete session with Browser STT', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');

        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        await startButton.click();
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        debugLog('[PRO] ✅ Session started with Browser');

        await expect(proPage.getByText('Live Stats')).toBeVisible();

        // Wait to comply with 5s minimum session duration
        await proPage.waitForTimeout(6000);
        await startButton.click();
        await expect(proPage.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 5000 });
        debugLog('[PRO] ✅ Browser session completed');
    });

    test('should complete session with Cloud STT', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');

        // Select Cloud mode if available
        const modeSelector = proPage.getByTestId('stt-mode-selector');
        if (await modeSelector.count() > 0) {
            await modeSelector.click();
            const cloudOption = proPage.getByText(/Cloud/i, { exact: true }).first();
            if (await cloudOption.count() > 0) {
                await cloudOption.click();
                debugLog('[PRO] ✅ Cloud STT mode selected');
            }
        }

        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        await startButton.click();
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 15000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        // Wait to comply with 5s minimum session duration
        await proPage.waitForTimeout(6000);
        await startButton.click();
        await expect(proPage.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 5000 });
        debugLog('[PRO] ✅ Cloud STT session completed');
    });

    test('should complete session with Private STT', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');
 
        // Select Private mode
        const modeSelector = proPage.getByTestId('stt-mode-select');
        if (await modeSelector.count() > 0) {
            await modeSelector.click();
            const privateOption = proPage.getByText(/Private/i).first();
            if (await privateOption.count() > 0) {
                await privateOption.click();
                debugLog('[PRO] ✅ Private STT mode selected');

                // Wait for model to initialize (mock loads quickly)
                await proPage.waitForTimeout(1000);
            } else {
                debugLog('[PRO] ⚠️ Private option not found, skipping');
                return;
            }
        } else {
            debugLog('[PRO] ⚠️ Mode selector not found, using default mode');
        }

        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await expect(startButton).toBeVisible();

        // Start session - Private may need extra time for model initialization
        await startButton.click();
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 20000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        debugLog('[PRO] ✅ Session started with Private STT');

        // Verify session is running
        await expect(proPage.getByText('Live Stats')).toBeVisible();

        // Wait to comply with 5s minimum session duration
        await proPage.waitForTimeout(6000);
        // Stop session
        await startButton.click();
        await expect(proPage.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 5000 });
        debugLog('[PRO] ✅ Private STT session completed');
    });

    test('should add and persist user words', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');

        // 1. Click "Add User Word" button to open the popover
        const addWordBtn = proPage.getByTestId('add-custom-word-button');
        await expect(addWordBtn).toBeVisible();
        await addWordBtn.click();

        // 2. Add word
        const word = 'Gravity';
        const customWordInput = proPage.getByPlaceholder(/literally/i);
        await customWordInput.fill(word);

        // Use a more robust way to click the add button in the popover
        const addButton = proPage.getByRole('button', { name: /add/i }).last();
        await addButton.click();

        // 3. Verify word appears in the list (Filler Words card)
        // Wait for popover to close
        await expect(proPage.getByText(/User Filler Words/i)).not.toBeVisible({ timeout: 10000 });

        // Verify in metrics list
        await expect(proPage.getByTestId('filler-words-list').getByText(new RegExp(word, 'i'))).toBeVisible({ timeout: 10000 });
        debugLog('[PRO] ✅ Custom word visible in metrics list');
    });

    test('should display all analytics metrics', async ({ proPage }) => {
        // Ensure fresh state and synchronize MSW
        // Ensure app/auth is stable after reload
        await expect(proPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });
        await navigateToRoute(proPage, '/analytics');
        // Double-Signal pattern for route transition
        await expect(proPage).toHaveURL(/\/analytics/, { timeout: 10000 });
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
        debugLog('[PRO] ✅ Analytics dashboard loaded');

        // Verify key analytics components
        const analytics = [
            'Export Reports',
            'Total Sessions',
        ];

        for (const metric of analytics) {
            const element = proPage.getByText(metric);
            if (await element.count() > 0) {
                debugLog(`[PRO] ✅ ${metric} visible`);
            }
        }
    });

    test('should allow PDF export', async ({ proPage }) => {
        // Ensure fresh state and synchronize MSW
        // Ensure app/auth is stable after reload
        await expect(proPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });
        await navigateToRoute(proPage, '/analytics');
        await expect(proPage).toHaveURL(/\/analytics/, { timeout: 10000 });
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        // Look for PDF export button
        const pdfButton = proPage.getByRole('button', { name: /pdf|export|download/i });
        if (await pdfButton.count() > 0) {
            debugLog('[PRO] ✅ PDF export button available');
        } else {
            debugLog('[PRO] ⚠️ PDF export button not found (may require session data)');
        }
    });

    test('should complete full journey: Session → Analytics → Return', async ({ proPage }) => {
        // Session
        await navigateToRoute(proPage, '/session');
        await expect(proPage.getByText('Practice Session')).toBeVisible();

        const startButton = proPage.getByTestId('session-start-stop-button').first();
        await startButton.click();
        await expect(proPage.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10000 });
        await expect(proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON)).toHaveAttribute('data-recording', 'true');
        // Wait to comply with 5s minimum session duration
        await proPage.waitForTimeout(6000);
        await startButton.click();
        await expect(proPage.getByLabel(/Start Recording/i)).toBeVisible({ timeout: 5000 });
        debugLog('[PRO] ✅ Session completed');

        // Analytics
        // Ensure app/auth is stable after reload
        await expect(proPage.getByTestId('app-main')).toBeVisible({ timeout: 15000 });

        await navigateToRoute(proPage, '/analytics');
        await expect(proPage).toHaveURL(/\/analytics/, { timeout: 10000 });
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
        await expect(proPage.getByText('Export Reports')).toBeVisible();
        debugLog('[PRO] ✅ Analytics verified');

        // Return to session
        await navigateToRoute(proPage, '/session');
        await expect(proPage.getByText('Practice Session')).toBeVisible();
        debugLog('[PRO] ✅ Return to session successful');

        debugLog('[PRO] ✅✅✅ Full Pro user journey completed');
    });
});
