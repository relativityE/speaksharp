import { expect, test, type Page } from '@playwright/test';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

const SCREENSHOT_DIR = 'test-results/1116-practice-focus-onramp';

async function installCalibrationSpeechRecognition(page: Page) {
  await page.evaluate(() => {
    class CalibrationSpeechRecognition {
      lang = 'en-US';
      interimResults = true;
      continuous = true;
      maxAlternatives = 1;
      onresult: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;
      onaudioend: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      onsoundstart: (() => void) | null = null;
      onsoundend: (() => void) | null = null;
      onnomatch: ((event: Event) => void) | null = null;

      start() {
        setTimeout(() => {
          this.onstart?.();
          this.onaudiostart?.();
          this.onsoundstart?.();
          this.onspeechstart?.();
        }, 10);
      }

      stop() {
        setTimeout(() => {
          this.onspeechend?.();
          this.onsoundend?.();
          this.onaudioend?.();
          this.onend?.();
        }, 0);
      }

      abort() { this.stop(); }
    }

    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: CalibrationSpeechRecognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: CalibrationSpeechRecognition });
  });
}

async function storageSnapshot(page: Page) {
  return page.evaluate(() => ({
    local: Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]),
    session: Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)]),
  }));
}

test.describe('#1116 Freestyle practice-focus on-ramp', () => {
  test('is usable at desktop/mobile and calibration creates no application write', async ({ page }) => {
    const applicationWrites: string[] = [];
    let calibrationStarted = false;
    page.on('request', (request) => {
      if (!calibrationStarted) return;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        applicationWrites.push(`${request.method()} ${request.url()}`);
      }
    });

    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await page.setViewportSize({ width: 1280, height: 960 });
    await navigateToRoute(page, '/practice');
    const origin = page.getByTestId('practice-card-quick');
    await origin.focus();
    await origin.click();
    await expect(page.getByTestId('freestyle-onramp-dialog')).toBeVisible();

    // Keyboard-only selection uses the radiogroup's roving focus contract.
    const justPractice = page.getByRole('radio', { name: 'Just practice' });
    await justPractice.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Be more concise' })).toBeFocused();
    await expect(page.getByRole('radio', { name: 'Be more concise' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Give me a prompt' }).click();
    await expect(page.getByTestId('freestyle-prompt')).toContainText('Explain something you worked on recently');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-onramp.png`, fullPage: true });

    await page.getByRole('button', { name: 'Let me test with a sample' }).click();
    await expect(page.getByTestId('calibration-dialog')).toBeVisible();
    await page.waitForTimeout(250);
    await expect(page.getByTestId('calibration-passage')).toContainText('Good communication starts with a clear purpose.');
    await expect(page.getByText(/Your browser manages transcription and may use its own speech service/)).toBeVisible();
    const storageBefore = await storageSnapshot(page);
    // The shared E2E bridge installs a silent recognizer while the application
    // boots. Replace it immediately before calibration constructs its Browser
    // leaf engine so this journey proves the acoustic-ready onReady boundary.
    await installCalibrationSpeechRecognition(page);
    calibrationStarted = true;
    await page.getByRole('button', { name: 'Start 30-second test' }).click();
    await expect(page.getByText(/Listening—read the passage aloud/)).toBeVisible();
    await page.evaluate(() => {
      const recognition = (window as Window & {
        __activeSpeechRecognition?: { onresult?: ((event: unknown) => void) | null };
      }).__activeSpeechRecognition;
      if (!recognition?.onresult) throw new Error('Calibration did not expose the real Browser engine.');
      const result = [{ transcript: 'This temporary sample confirms that my microphone can hear me.' }] as Array<{ transcript: string }> & { isFinal: boolean };
      result.isFinal = true;
      recognition.onresult({ resultIndex: 0, results: [result] });
    });
    await expect(page.getByTestId('calibration-transcript')).toContainText('temporary sample', { timeout: 10_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-calibration.png`, fullPage: true });
    await page.getByRole('button', { name: 'Stop test' }).click();
    await expect(page.getByText(/Test complete/)).toBeVisible();
    const storageAfter = await storageSnapshot(page);

    expect(applicationWrites, `calibration emitted application writes: ${applicationWrites.join(' | ')}`).toEqual([]);
    expect(storageAfter).toEqual(storageBefore);

    await page.getByTestId('close-calibration-button').click();
    await expect(page.getByTestId('calibration-dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Let me test with a sample' })).toBeFocused();
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('freestyle-onramp-dialog')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-onramp.png`, fullPage: true });
    await page.getByRole('button', { name: 'Let me test with a sample' }).click();
    await expect(page.getByTestId('calibration-dialog')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-calibration.png`, fullPage: true });
    await page.getByTestId('close-calibration-button').click();
    await page.getByTestId('continue-freestyle-button').click();
    await expect(page).toHaveURL(/\/session\?focus=concise&prompt=recent-work$/, { timeout: 30_000 });
    await expect(page.getByTestId('freestyle-prompt-card')).toContainText('Be more concise');
    await expect(page.getByTestId('freestyle-prompt-card')).toContainText('Explain something you worked on recently');
    await page.getByRole('button', { name: 'Dismiss Freestyle setup' }).click();
    await expect(page.getByTestId('freestyle-prompt-card')).toBeHidden();
  });
});
