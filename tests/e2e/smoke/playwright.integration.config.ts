import { defineConfig } from '@playwright/test';
import config from '../../../playwright.config';

/**
 * Specialized config for High-Fidelity Integration tests
 * Injects a real audio file for unmocked Whisper verification
 */
export default defineConfig({
  ...config,
  testDir: '.', // Relative to this config file
  use: {
    ...config.use,
    launchOptions: {
      ...config.use?.launchOptions,
      args: [
        ...(config.use?.launchOptions?.args || []),
        '--use-file-for-fake-audio-capture=/Users/fibonacci/SW_Dev/Antigravity_Dev/speaksharp/tests/fixtures/jfk_16k.wav',
      ],
    },
  },
});
