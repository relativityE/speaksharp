import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';

loadEnv('development');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/canary',
    testMatch: 'promo-signup.canary.spec.ts',
    outputDir: './test-results/promo-canary',
    timeout: 60000,
    retries: 0,
    reporter: [['html', { outputFolder: 'playwright-report/promo-canary' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: process.env.BASE_URL || 'https://speaksharp-public.vercel.app',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: getChromeWithMic() }],
});
