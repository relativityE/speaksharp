import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import logger from '../../frontend/src/lib/logger';

interface E2EWindow {
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    __E2E_MANUAL_PROGRESS__?: boolean;
    __E2E_ADVANCE_PROGRESS__?: (progress: number) => void;
    __E2E_MOCK_PROFILE__?: { subscription_status: string };
    __e2eProfileLoaded__?: boolean;
}

test.describe('Diagnostic Private STT', () => {
    test.afterEach(async ({ proPage: page }) => {
        await page.evaluate(() => {
            // 1. Reset behavioral gating signal
            document.body.removeAttribute('data-stt-policy');
            
            // 2. Clear engine overrides
            window.__TEST_REGISTRY__?.clear();
            
            // 3. Reset service ephemeral state
            // @ts-ignore - Internal test hook
            window.__TRANSCRIPTION_SERVICE__?.resetEphemeralState();
        });
    });

    test('DIAGNOSTIC: check isProUser and profile state', async ({ proPage: page }) => {
        // Capture ALL browser console output
        page.on('console', msg => {
            logger.info(`[BROWSER ${msg.type()}] ${msg.text()}`);
        });

        const { enableTestRegistry, registerMockInE2E } = await import('../helpers/testRegistry.helpers');
        await enableTestRegistry(page);
        
        // Register mock for diagnostic
        await registerMockInE2E(page, 'private', `() => {
            return {
                init: async () => {},
                startTranscription: async () => {},
                stopTranscription: async () => 'diagnostic transcript',
                getTranscript: async () => 'diagnostic transcript',
                getEngineType: () => 'mock-diagnostic'
            };
        }`);

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
        logger.info({ profileState }, '[DIAG] Window profile state');

        // Set mock flags
        await page.evaluate(() => {
            const win = window as unknown as E2EWindow;
            win.__E2E_MOCK_LOCAL_WHISPER__ = true;
            win.__E2E_MANUAL_PROGRESS__ = true;
        });

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();
        await expect(page.getByTestId('stt-mode-select')).toHaveText(/Private|Native/i, { timeout: 3000 });
        logger.info('[DIAG] Mode confirmed: Private');

        // Click Start
        await page.getByTestId('session-start-stop-button').click();
        await page.waitForTimeout(3000);

        // Check results
        const statusHeader = page.getByTestId('live-session-header');
        await expect(statusHeader).toBeVisible();

        await expect(statusHeader).toHaveAttribute('data-recording', 'true');
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true');
        await expect(page.getByTestId('stt-mode-select')).toHaveText(/Private/i);
    });
});
