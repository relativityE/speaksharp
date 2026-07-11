/**
 * @file playwright.deployed-live.config.ts
 * @description Playwright configuration for deployed live validation.
 *
 * Use this for production/staging browser evidence where the app is already
 * hosted. Unlike playwright.live.config.ts, this config never starts a local
 * Vite server, which avoids local bind/sandbox failures being mistaken for app
 * defects.
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';

loadEnv('test');
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const LIVE_AUDIO_FIXTURE = fileURLToPath(new URL('./tests/fixtures/harvard_benchmark_16k.wav', import.meta.url));
const chromeWithMic = getChromeWithMic();

export default defineConfig({
  ...baseConfig,
  testDir: './tests',
  testMatch: /.*\.live\.spec\.ts/,
  outputDir: './test-results/deployed-live',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI
    ? [['line'], ['github']]
    : [['html', { outputFolder: 'playwright-report/deployed-live' }], ['list']],
  use: {
    ...baseConfig.use,
    baseURL: process.env.BASE_URL || 'https://speaksharp-public.vercel.app',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Vercel PREVIEW deployments sit behind Deployment Protection (SSO), which redirects unauthenticated
    // requests to vercel.com/sso and blocks DAST. When testing a preview (e.g. validating a fix before
    // merge, or the #960 per-commit bisect), set VERCEL_AUTOMATION_BYPASS_SECRET (Vercel → Deployment
    // Protection → Protection Bypass for Automation) so requests carry the bypass header. Absent (the
    // default, e.g. against the PUBLIC prod URL) → no header, unchanged behavior.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
  },
  projects: [
    {
      name: 'deployed-live-chromium',
      use: {
        ...chromeWithMic,
        launchOptions: {
          ...chromeWithMic.launchOptions,
          args: [
            ...(chromeWithMic.launchOptions?.args ?? []),
            `--use-file-for-fake-audio-capture=${LIVE_AUDIO_FIXTURE}`,
            '--disable-blink-features=AutomationControlled',
            '--disable-cache',
            '--disable-application-cache',
            '--disk-cache-size=0',
            '--media-cache-size=0',
          ],
        },
      },
    },
  ],
});
