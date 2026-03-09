import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

interface E2EWindow {
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    __E2E_MANUAL_PROGRESS__?: boolean;
    __E2E_ADVANCE_PROGRESS__?: (progress: number) => void;
    __E2E_MOCK_PROFILE__?: { subscription_status: string };
    __e2eProfileLoaded__?: boolean;
}

test('DIAGNOSTIC: check isProUser and profile state', async ({ page }) => {
    // Capture ALL browser console output
    page.on('console', msg => {
        console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    });

    await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
    await navigateToRoute(page, '/session');
    await page.waitForSelector('[data-testid="app-main"]');

    // Check profile state in window
    const profileState = await page.evaluate(() => {
        const win = window as unknown as E2EWindow;
        return {
            mockProfile: win.__E2E_MOCK_PROFILE__,
            profileLoaded: win.__e2eProfileLoaded__,
        };
    });
    console.log(`[DIAG] Window profile state:`, JSON.stringify(profileState));

    // Set mock flags
    await page.evaluate(() => {
        const win = window as unknown as E2EWindow;
        win.__E2E_MOCK_LOCAL_WHISPER__ = true;
        win.__E2E_MANUAL_PROGRESS__ = true;
    });

    // Check profile state AFTER setting mock flags (in case they interfere)
    const profileStateAfter = await page.evaluate(() => {
        const win = window as unknown as E2EWindow;
        return {
            mockProfile: win.__E2E_MOCK_PROFILE__,
            profileLoaded: win.__e2eProfileLoaded__,
        };
    });
    console.log(`[DIAG] Profile state AFTER flags:`, JSON.stringify(profileStateAfter));

    // Check what the profile fetched data actually contains in React state
    // We can expose this by checking the profile query cache
    const reactProfileState = await page.evaluate(() => {
        // Try to read from React Query cache via __REACT_QUERY_DEVTOOLS_GLOBAL_STORE__
        // Or check if there's any exposed state
        // Actually, let's just check the subscription_status from the mock route
        const profileFlag = (window as unknown as E2EWindow).__E2E_MOCK_PROFILE__;
        return {
            profileFlag: profileFlag,
            flagSubscriptionStatus: profileFlag?.subscription_status,
        };
    });
    console.log(`[DIAG] React profile state:`, JSON.stringify(reactProfileState));

    // Select Private mode
    await page.getByTestId('stt-mode-select').click();
    await page.getByRole('menuitemradio', { name: /private/i }).click();
    await expect(page.getByTestId('stt-mode-select')).toHaveText(/Private|Native/i, { timeout: 3000 });
    console.log(`[DIAG] Mode confirmed: Private`);

    // Check one more time before clicking Start
    const preStartProfile = await page.evaluate(() => {
        const win = window as unknown as E2EWindow;
        return {
            mockProfile: win.__E2E_MOCK_PROFILE__,
            profileLoaded: win.__e2eProfileLoaded__,
        };
    });
    console.log(`[DIAG] Pre-start profile state:`, JSON.stringify(preStartProfile));

    // Click Start
    await page.getByTestId('session-start-stop-button').click();
    await page.waitForTimeout(3000);

    // Check results
    const statusHeader = page.getByTestId('live-session-header');
    await expect(statusHeader).toBeVisible();

    const isRecordingAttribute = await statusHeader.getAttribute('data-recording');
    console.log(`[DIAG] Status bar data-recording: "${isRecordingAttribute}"`);

    const modeText = await page.getByTestId('stt-mode-select').textContent();
    console.log(`[DIAG] Mode button: "${modeText}"`);

    // The test: After starting in Private mode with mock engine, recording starts immediately.
    // We assert on behavioral attributes, not text.
    await expect(statusHeader).toHaveAttribute('data-recording', 'true');
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true');
    await expect(page.getByTestId('stt-mode-select')).toHaveText(/Private/i);
});
