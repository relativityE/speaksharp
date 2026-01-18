import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLoginWithRoutes, attachLiveTranscript, debugLog } from './helpers';

test.describe('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ page }) => {
    // Mock browser APIs BEFORE navigation to ensure they are available when the app loads
    // Only need to mock getUserMedia and AudioContext - SpeechRecognition is handled by e2e-bridge.ts
    await page.addInitScript(() => {
      // Mock getUserMedia
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: async () => {
            return {
              getTracks: () => [],
              getAudioTracks: () => [{
                stop: () => { },
                enabled: true
              }],
              getVideoTracks: () => [],
            };
          }
        },
        writable: true,
      });

      // Mock AudioContext
      Object.defineProperty(window, 'AudioContext', {
        writable: true,
        value: class MockAudioContext {
          audioWorklet = {
            addModule: async () => {
              return Promise.resolve();
            }
          };
          destination = {};

          constructor() {
          }
          createMediaStreamSource() {
            const chainable = {
              connect: () => chainable,
              disconnect: () => { }
            };
            return chainable;
          }
          createScriptProcessor() {
            return {
              connect: () => { },
              disconnect: () => { },
              onaudioprocess: null
            };
          }
          createGain() {
            const chainable = {
              connect: () => chainable,
              disconnect: () => { }
            };
            return {
              gain: { value: 1 },
              connect: chainable.connect,
              disconnect: chainable.disconnect
            };
          }
          get sampleRate() { return 16000; }
          get state() { return 'running'; }
          resume() { return Promise.resolve(); }
          close() { return Promise.resolve(); }
        }
      });

      // Mock AudioWorkletNode
      Object.defineProperty(window, 'AudioWorkletNode', {
        writable: true,
        value: class MockAudioWorkletNode {
          port = {
            onmessage: null
          };
          connect() { return { connect: () => { } }; }
          disconnect() { }
          constructor() {
          }
        }
      });
    });

    attachLiveTranscript(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await programmaticLoginWithRoutes(page);

    const sessionPage = new SessionPage(page);
    debugLog('[TEST DEBUG] Navigating to session page...');
    await sessionPage.navigate(); // Uses navigateToRoute internally - preserves MSW context

    // Ensure E2E bridge is ready before proceeding
    // Ensure E2E bridge is ready before proceeding
    debugLog('[TEST DEBUG] ⏳ Waiting for E2E bridge readiness...');
    await page.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

    debugLog('[TEST DEBUG] Checking start button state...');
    // We expect the button to be enabled now that we fixed the disabled logic
    // But it might still be disabled briefly while profile loads
    await expect(sessionPage.startButton).toBeEnabled({ timeout: 10000 });

    debugLog('[TEST DEBUG] Clicking start button...');
    await sessionPage.startButton.click({ timeout: 15000 });

    // Wait for speech recognition to be ready
    debugLog('[TEST DEBUG] Waiting for speech recognition to be active...');
    await page.waitForFunction(() => {
      return !!(window as Window & { __activeSpeechRecognition?: unknown }).__activeSpeechRecognition;
    }, null, { timeout: 10000 });

    // Verify that the UI updates to show the session is active
    debugLog('[TEST DEBUG] Waiting for session status indicator...');
    const sessionActiveIndicator = page.getByTestId('session-status-indicator');
    await expect(sessionActiveIndicator).toHaveText(/● Recording/); // Match with or without mode suffix

    // The transcript container should show that we're listening
    debugLog('[TEST DEBUG] Waiting for transcript container to show "Listening..."...');
    const transcriptContainer = page.getByTestId('transcript-container');
    await expect(transcriptContainer).toContainText('Listening...', { timeout: 5000 });

    // Use the existing e2e-bridge infrastructure to dispatch a mock transcript
    debugLog('[TEST DEBUG] Dispatching mock transcript via window.dispatchMockTranscript...');
    await page.waitForFunction(() => typeof (window as unknown as { dispatchMockTranscript: unknown }).dispatchMockTranscript === 'function', null, { timeout: 5000 });
    await page.evaluate(() => {
      const win = window as Window & { dispatchMockTranscript?: (text: string, isFinal: boolean) => void };
      if (win.dispatchMockTranscript) {
        win.dispatchMockTranscript('This is a mock transcript.', true);
      }
    });

    // Verify the transcript appears (Note: UI strips spaces in rendering)
    debugLog('[TEST DEBUG] Waiting for mock transcript to appear...');
    await expect(transcriptContainer).toContainText('Thisisamocktranscript', { timeout: 15000 });
    debugLog('[TEST DEBUG] ✅ Mock transcript appeared.');
  });
});
