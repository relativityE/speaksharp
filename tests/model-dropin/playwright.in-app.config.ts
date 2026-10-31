import { defineConfig } from '@playwright/test';
const baseURL = process.env.EVAL_APP_URL;
if (!baseURL || !['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'].includes(baseURL)) {
  throw Error('bounded_loopback_app_required');
}
if (!process.env.EVAL_PRIVATE_OUTPUT) throw Error('bounded_private_output_required');
const endpoint=process.env.EVAL_BROWSER_WS_ENDPOINT;
if(!endpoint||new URL(endpoint).protocol!=='ws:'||!['127.0.0.1','localhost'].includes(new URL(endpoint).hostname))throw Error('bounded_owned_browser_endpoint_required');
export default defineConfig({
  testDir: '.', testMatch: 'inAppComparison.live.spec.ts', outputDir: process.env.EVAL_PRIVATE_OUTPUT,
  workers: 1, fullyParallel: false, retries: 0, maxFailures: 1, timeout: 420_000,
  globalTimeout: 7_680_000, reporter: [['list']],
  use: { baseURL, channel: 'chrome', headless: false, serviceWorkers: 'block',
    connectOptions:{wsEndpoint:endpoint},
    permissions: ['microphone'], viewport: { width: 1440, height: 1000 },
    trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: { chromiumSandbox: true,
      args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
});
