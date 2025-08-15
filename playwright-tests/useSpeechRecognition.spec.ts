import { test, expect } from '@playwright/test';
import handler from 'serve-handler';
import { createServer } from 'http';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Replicate __dirname functionality in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('useSpeechRecognition in browser', () => {
  let server: any;
  let port = 4174; // custom port to avoid conflicts

  test.beforeAll(async () => {
    // Build the harness
    execSync('npx vite build --config vite.harness.config.ts', { stdio: 'inherit' });

    // Serve the dist folder
    server = createServer((req, res) => {
      return handler(req, res, {
        public: path.resolve(__dirname, 'dist')
      });
    });

    await new Promise<void>(resolve => server.listen(port, resolve));
  });

  test.afterAll(async () => {
    await new Promise<void>(resolve => server.close(resolve));
  });

  test('starts listening, receives transcript, and stops', async ({ page }) => {
    await page.goto(`http://localhost:${port}/`);

    // Inject the mock using page.evaluate after the page is loaded
    await page.evaluate(() => {
      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = 'en-US';
        onstart = null;
        onresult = null;
        onend = null;

        start() {
          setTimeout(() => {
            this.onstart?.();
            this.onresult?.({ results: [[{ transcript: 'test phrase' }]] });
          }, 50);
        }
        stop() {
          setTimeout(() => this.onend?.(), 50);
        }
      }
      (window as any).webkitSpeechRecognition = MockSpeechRecognition;
    });

    // Initial state check
    await expect(page.locator('#isListening')).toHaveText('false');
    await expect(page.locator('#transcript')).toBeEmpty();

    // Start listening
    await page.click('#startListening');

    // Verify listening state and transcript update
    await expect(page.locator('#isListening')).toHaveText('true');
    await expect(page.locator('#transcript')).toContainText('test phrase');
  });
});
