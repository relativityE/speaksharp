import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { debugLog } from '../e2e/helpers';

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
     * Native STT (Web Speech API) requires:
     * - Headed browser (already guaranteed by playwright.live.config.ts: headless: false)
     * - Chrome's online speech recognition service (network dependent)
     * - Fake audio device (configured via launchOptions above)
     *
     * This test only runs via `pnpm test:system:local:headed` or `pnpm ci:dispatch:deploy`.
     * It is NOT part of GitHub CI (ci.yml only runs tests/e2e).
     */
    test('should transcribe real audio using Native STT', async ({ page }) => {
        const transcriptContainer = page.getByTestId('transcript-container');

        // Increase timeout because real STT takes time
        await expect(transcriptContainer).toContainText(/Americans|fellow|ask not/i, { timeout: 30000 });

        debugLog('✅ Real Transcript verified: "Americans/fellow" detected');
    });
});
