import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const audioFile = path.resolve(__dirname, '../fixtures/jfk_16k.wav');

// Native STT requires specific args
test.use({
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${audioFile}`
        ]
    },
    permissions: ['microphone']
});

test.describe('Live Transcript (Real Audio)', () => {
    // Native STT is Chrome-only and requires online connectivity
    test.skip(({ browserName }) => browserName !== 'chromium', 'Native STT only supported on Chromium');

    /**
     * KNOWN LIMITATION: Native STT (Web Speech API) does not work in headless Chrome.
     * This test is designed for headed mode or manual verification.
     * In CI, this test is expected to timeout/fail - marked as skipped via fixme.
     *
     * The HIGH-FIDELITY value: When run manually, this test verifies real audio → real transcription.
     */
    test.fixme('should transcribe real audio using Native STT', async ({ page }) => {
        console.log('kp🎤 Running High-Fidelity AUDIO test with Native STT');
        console.log(`📂 Injecting audio: ${audioFile}`);

        // 1. Programmatic Login (focus is on STT, not Auth here)
        // We reuse the existing helper which mocks the session for speed,
        // OR we could use real auth if we wanted (but let's keep it focused).
        // For "High Fidelity" of the STT pipeline, the Auth method matters less than the Audio pipeline.
        // Let's rely on the standard login helper for stability.
        const { programmaticLoginWithRoutes, navigateToRoute } = await import('./helpers');
        await programmaticLoginWithRoutes(page);

        // 2. Go to Session Page
        await navigateToRoute(page, '/session');

        // 3. Switch to Native Mode
        // Open the mode selector menu (it might be "Cloud AI" or "On-Device" initially)
        const modeButton = page.getByRole('button', { name: /Native|Cloud AI|On-Device/ });
        await modeButton.click();

        // Select "Native" from the dropdown
        await page.getByRole('menuitemradio', { name: 'Native' }).click();
        console.log('✅ Switched to Native STT Mode');

        // 4. Start Recording
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('session-status-indicator')).toContainText('Recording');

        // 5. Verify Real Transcript Logic
        // The JFK file says "And so my fellow Americans..."
        // Native STT is non-deterministic but should capture "Americans" or "fellow".
        console.log('👂 Listening for transcript...');

        const transcriptContainer = page.getByTestId('transcript-container');

        // Increase timeout because real STT takes time
        await expect(transcriptContainer).toContainText(/Americans|fellow|ask not/i, { timeout: 30000 });

        console.log('✅ Real Transcript verified: "Americans/fellow" detected');
    });
});
