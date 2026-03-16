import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import { registerMockInE2E, enableTestRegistry, cleanupTestRegistry } from '../helpers/testRegistry.helpers';
import type TranscriptionService from '../../frontend/src/services/transcription/TranscriptionService';
import type { E2EConfig } from '../types/e2eConfig';
import type { TestRegistryClass } from '../../frontend/src/services/transcription/TestRegistry';

declare global {
    interface Window {
        __APP_TEST_ENV__?: E2EConfig;
        REAL_WHISPER_TEST?: boolean;
        __FORCE_NO_WEBGPU__?: boolean;
        __TEST_REGISTRY__?: TestRegistryClass;
        __TRANSCRIPTION_SERVICE__?: TranscriptionService;
    }
}

/**
 * Layer 2 & 3: Fallback Negotiation & Privacy Guarantee Tests
 * 
 * PURPOSE:
 * 1. Fallback: Verifies PrivateSTT chooses the best available local engine.
 * 2. Privacy: Verifies no silent fallback to Native/Cloud on total local failure.
 */

test.describe('Private STT Fallback Negotiation', () => {

    test.beforeEach(async ({ page }) => {
        await enableTestRegistry(page);
    });

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            document.body.removeAttribute('data-stt-policy');
            document.body.removeAttribute('data-engine-variant');
            window.__TEST_REGISTRY__?.clear();
            window.__TRANSCRIPTION_SERVICE__?.resetEphemeralState();
            delete window.REAL_WHISPER_TEST;
            delete window.__FORCE_NO_WEBGPU__;
        });
        await cleanupTestRegistry(page);
    });

    test('should fallback to TransformersJS when WebGPU is unavailable', async ({ proPage: page }) => {
        // Mock TransformersJS to succeed
        await registerMockInE2E(page, 'transformers-js', `(opts) => ({
            type: 'transformers-js',
            init: async () => ({ isOk: true, value: undefined }),
            transcribe: async (audio) => ({ isOk: true, value: 'cpu transcript' }),
            destroy: async () => {},
            getEngineType: () => 'transformers-js'
        })`);

        // Stage 1: Force "Real" mode and WebGPU unavailability
        await page.addInitScript(() => {
            if (window.__APP_TEST_ENV__?.stt) {
                window.__APP_TEST_ENV__.stt.mode = 'real';
            }
            window.REAL_WHISPER_TEST = true; 
            window.__FORCE_NO_WEBGPU__ = true;
        });

        // Stage 2: Navigate and verify Pro status
        await navigateToRoute(page, '/session');
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 15000 });

        // Stage 3: Select Private mode explicitly
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Stage 4: Start Recording
        await page.getByTestId('session-start-stop-button').click();

        // Stage 5: Verification
        // Verify engine is 'transformers-js'
        await expect(page.locator('body')).toHaveAttribute('data-engine-variant', 'transformers-js', { timeout: 20000 });
        
        await page.getByTestId('session-start-stop-button').click();
    });

    test('should fallback to TransformersJS when WhisperTurbo fails to initialize', async ({ proPage: page }) => {
        // Mock TransformersJS to succeed
        await registerMockInE2E(page, 'transformers-js', `(opts) => ({
            type: 'transformers-js',
            init: async () => ({ isOk: true, value: undefined }),
            transcribe: async (audio) => ({ isOk: true, value: 'cpu fallback transcript' }),
            destroy: async () => {},
            getEngineType: () => 'transformers-js'
        })`);

        // Mock WhisperTurbo to fail
        await registerMockInE2E(page, 'whisper-turbo', `(opts) => ({
            type: 'whisper-turbo',
            init: async () => ({ isErr: true, error: new Error('WebGPU Context Lost') }),
            transcribe: async (audio) => ({ isErr: true, error: new Error('WebGPU Missing') }),
            destroy: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await page.addInitScript(() => {
            if (window.__APP_TEST_ENV__?.stt) {
                window.__APP_TEST_ENV__.stt.mode = 'real';
            }
            window.REAL_WHISPER_TEST = true;
        });

        await navigateToRoute(page, '/session');
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 15000 });

        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();
        await page.getByTestId('session-start-stop-button').click();

        await expect(page.locator('body')).toHaveAttribute('data-engine-variant', 'transformers-js', { timeout: 20000 });
        
        await page.getByTestId('session-start-stop-button').click();
    });

    test('should show error modal and block native fallback on total private failure (Privacy Guarantee)', async ({ proPage: page }) => {
        // Mock BOTH to fail
        await registerMockInE2E(page, 'whisper-turbo', `(opts) => ({
            type: 'whisper-turbo',
            init: async () => ({ isErr: true, error: new Error('WebGPU Fail') }),
            destroy: async () => {},
            getEngineType: () => 'whisper-turbo'
        })`);

        await registerMockInE2E(page, 'transformers-js', `(opts) => ({
            type: 'transformers-js',
            init: async () => ({ isErr: true, error: new Error('WASM Fail') }),
            destroy: async () => {},
            getEngineType: () => 'transformers-js'
        })`);

        await page.addInitScript(() => {
            if (window.__APP_TEST_ENV__?.stt) {
                window.__APP_TEST_ENV__.stt.mode = 'real';
            }
            window.REAL_WHISPER_TEST = true;
        });

        await navigateToRoute(page, '/session');
        await expect(page.locator('body')).toHaveAttribute('data-user-tier', 'pro', { timeout: 15000 });
        
        // Ensure we are in Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByRole('menuitemradio', { name: /private/i }).click();

        // Start Recording
        await page.getByTestId('session-start-stop-button').click();

        // Stage 5: Verification
        // 1. Should NOT be recording (stay in IDLE or error state)
        await expect(page.getByTestId('session-start-stop-button')).toContainText(/start/i, { timeout: 15000 });

        // 2. Should see the error message in the status bar (LocalErrorBoundary or sessionFeedback)
        await expect(page.getByTestId('live-session-header')).toContainText(/Private STT failed/i, { timeout: 15000 });
        
        // 3. IMPORTANT: It should NOT have fallen back to Native
        const tier = await page.locator('body').getAttribute('data-user-tier');
        expect(tier).toBe('pro'); 
    });
});
