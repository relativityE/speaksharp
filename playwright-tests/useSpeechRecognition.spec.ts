// playwright-tests/useSpeechRecognition.spec.ts - Optimized Test
import { test, expect } from '@playwright/test';

test.describe('Speech Recognition Component', () => {
  test.beforeEach(async ({ page }) => {
    // Set longer timeout for navigation
    page.setDefaultTimeout(45000);

    // Go to test harness
    await page.goto('/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    // Wait for React to hydrate (more reliable than waiting for specific elements)
    await page.waitForFunction(() => {
      return window.React !== undefined || document.readyState === 'complete';
    }, { timeout: 30000 });
  });

  test('should handle speech recognition', async ({ page }) => {
    // Mock the speech recognition API before the component loads
    await page.addInitScript(() => {
      // Mock speech recognition
      window.webkitSpeechRecognition = class MockSpeechRecognition {
        constructor() {
          this.continuous = false;
          this.interimResults = false;
          this.lang = 'en-US';
        }

        start() {
          setTimeout(() => {
            if (this.onresult) {
              this.onresult({
                results: [{
                  0: { transcript: 'Hello world' },
                  isFinal: true
                }],
                resultIndex: 0
              });
            }
          }, 100);
        }

        stop() {}
        abort() {}
      };

      window.SpeechRecognition = window.webkitSpeechRecognition;
    });

    // Wait for the page to be interactive with multiple strategies
    try {
      // Strategy 1: Wait for specific text content
      await page.waitForSelector('text=Speech Recognition Test', {
        timeout: 20000
      });
    } catch (error) {
      // Strategy 2: Wait for any button
      await page.waitForSelector('button', { timeout: 20000 });
    }

    // More robust element selection
    const modeButton = page.locator('button:has-text("Switch to Native")').first();

    // Wait for button to be actionable
    await modeButton.waitFor({
      state: 'visible',
      timeout: 15000
    });

    await expect(modeButton).toBeVisible();

    // Click with retry logic
    let clickSucceeded = false;
    for (let i = 0; i < 3 && !clickSucceeded; i++) {
      try {
        await modeButton.click({ timeout: 10000 });
        clickSucceeded = true;
      } catch (error) {
        if (i === 2) throw error; // Last attempt
        await page.waitForTimeout(1000); // Wait 1 second before retry
      }
    }

    // Continue with test...
    const recordButton = page.locator('button:has-text("Start")').first();
    await recordButton.waitFor({ state: 'visible', timeout: 10000 });
    await recordButton.click();

    // Verify the result
    await expect(page.locator('text=Hello world')).toBeVisible({ timeout: 5000 });
  });
});
