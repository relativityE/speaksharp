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
    // Inject the mock using addInitScript BEFORE the page loads
    await page.addInitScript(() => {
      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = 'en-US';
        onstart = null;
        onresult = null;
        onend = null;
        onerror = null;

        start() {
          if (this.onstart) {
            this.onstart(new Event('start'));
          }
          setTimeout(() => {
            if (this.onresult) {
              const event = new Event('result') as any;
              event.results = [[{ transcript: 'test phrase', confidence: 0.9 }]];
              this.onresult(event);
            }
          }, 100);
        }

        stop() {
          if (this.onend) {
            this.onend(new Event('end'));
          }
        }

        abort() {
            if (this.onend) {
                this.onend(new Event('end'));
            }
        }
      }
      // Make it available on the window object for the app to use
      (window as any).webkitSpeechRecognition = MockSpeechRecognition;
    });

    await page.goto(`http://localhost:${port}/`);

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
