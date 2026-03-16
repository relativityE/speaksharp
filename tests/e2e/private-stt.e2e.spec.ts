import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript } from './helpers';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';

/**
 * On-Device STT (Whisper) E2E Test Suite
 */

test.describe('Private STT (Whisper)', () => {

    test.skip(
        process.env.STT_ENGINE === 'real-hardware' && !process.env.HAS_GPU,
        'Private STT requires real GPU hardware. Set STT_ENGINE=real-hardware locally to verify on hardware.'
    );

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            // 1. Reset behavioral gating signal
            document.body.removeAttribute('data-stt-policy');
            document.body.removeAttribute('data-user-tier');
            document.body.removeAttribute('data-engine-variant');

            // 2. Clear engine overrides
            window.__TEST_REGISTRY__?.clear();

            // 3. Reset service ephemeral state
            // @ts-ignore - Internal test hook
            window.__TRANSCRIPTION_SERVICE__?.resetEphemeralState();
        });

        await expect(page.locator('body'))
            .not.toHaveAttribute('data-stt-policy', { timeout: 2000 });
        await expect(page.locator('body'))
            .not.toHaveAttribute('data-user-tier', { timeout: 2000 });
    });

    test('should show download progress on first use', async ({ proPage: page }) => {
        await enableTestRegistry(page);
        attachLiveTranscript(page);

        // Deterministic Gating
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 8000 });

        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="nav-sign-out-button"]');

        await page.evaluate(() => {
            const service = (window as unknown as { __TRANSCRIPTION_SERVICE__: { getPolicy: () => { allowFallback: boolean }; updatePolicy: (p: { allowFallback?: boolean }) => void } }).__TRANSCRIPTION_SERVICE__;
            if (!service) return;

            const currentPolicy = service.getPolicy();
            service.updatePolicy({
                ...currentPolicy,
                allowFallback: false
            });

            const originalUpdate = service.updatePolicy.bind(service);
            service.updatePolicy = (p: { allowFallback?: boolean }) => {
                originalUpdate({ ...p, allowFallback: false });
            };
        });

        // Register mock with progress control
        await registerMockInE2E(page, 'private', `(opts) => {
            let progressCb = opts?.onModelLoadProgress;
            return {
                init: async () => {
                   window.__E2E_ADVANCE_PROGRESS__ = (p) => { if (progressCb) progressCb(p); };
                   const err = new Error('CACHE_MISS');
                   Object.assign(err, { code: 'CACHE_MISS' });
                   throw err;
                },
                startTranscription: async () => { },
                stopTranscription: async () => 'test transcript',
                getTranscript: async () => 'test transcript',
                terminate: async () => { },
                getEngineType: () => 'whisper-turbo'
            };
        }`);

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Start Recording -> Triggers Download
        await page.getByTestId('session-start-stop-button').click();

        const indicator = page.getByTestId('background-task-indicator');
        await expect(indicator).toBeVisible();

        // Advance progress to 50%
        await page.evaluate('window.__E2E_ADVANCE_PROGRESS__(0.5)');
        await expect(indicator).toBeVisible();

        // Complete download (100%)
        await page.evaluate('window.__E2E_ADVANCE_PROGRESS__(1)');

        // Indicator should disappear and recording should start
        await expect(indicator).not.toBeVisible();
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true');

        // Stop session
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'false');

        const transcript = await page.evaluate(async () => {
            return await (window as unknown as { __TRANSCRIPTION_SERVICE__: { getTranscript: () => Promise<string> } }).__TRANSCRIPTION_SERVICE__?.getTranscript();
        });
        expect(transcript).toBe('test transcript');
    });

    test('should load instantly from cache', async ({ proPage: page }) => {
        await enableTestRegistry(page);
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 8000 });

        await registerMockInE2E(page, 'private', `() => ({
            init: async () => {}, // Instant success
            startTranscription: async () => {},
            stopTranscription: async () => 'cached transcript',
            getTranscript: async () => 'cached transcript',
            terminate: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await navigateToRoute(page, '/session');
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        const startButton = page.getByTestId('session-start-stop-button');
        const indicator = page.getByTestId('background-task-indicator');

        await startButton.click();
        await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 5000 });

        // Verify NO download indicator is visible
        await expect(indicator).toBeHidden();

        await startButton.click();
        await expect(startButton).toHaveAttribute('data-recording', 'false');
    });

    test('should restrict Private option for Free users', async ({ freePage: page }) => {
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'free', { timeout: 8000 });

        await navigateToRoute(page, '/session');
        await page.getByTestId('stt-mode-select').click();

        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        await expect(privateOption).toBeVisible();
        await expect(privateOption).toHaveAttribute('aria-disabled', 'true');
    });

    test('should show Private option for Pro users', async ({ proPage: page }) => {
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 8000 });

        await navigateToRoute(page, '/session');
        await page.getByTestId('stt-mode-select').click();

        const privateOption = page.getByRole('menuitemradio', { name: /private/i });
        await expect(privateOption).toBeVisible();
    });

    test('should handle download abandonment', async ({ proPage: page }) => {
        await enableTestRegistry(page);
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 8000 });

        await registerMockInE2E(page, 'private', `() => ({
            init: async () => {
                const err = new Error('CACHE_MISS');
                Object.assign(err, { code: 'CACHE_MISS' });
                throw err;
            },
            startTranscription: async () => {},
            stopTranscription: async () => 'abandoned',
            getTranscript: async () => 'abandoned',
            terminate: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await navigateToRoute(page, '/session');
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        await page.getByTestId('session-start-stop-button').click();
        const indicator = page.getByTestId('background-task-indicator');
        await expect(indicator).toBeVisible();

        // Stop session while downloading
        await page.getByTestId('session-start-stop-button').click();

        // Indicator should disappear and session should be idle
        await expect(indicator).not.toBeVisible();
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'false');
    });
});
