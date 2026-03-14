import { test, expect } from './fixtures';
import { SessionPage } from '../pom';
import { attachLiveTranscript, debugLog } from './helpers';

test.describe('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ userPage }) => {
    // Mock browser APIs BEFORE navigation to ensure they are available when the app loads
    // Only need to mock getUserMedia and AudioContext - SpeechRecognition is handled by e2e-bridge.ts
    // Note: Since userPage already performed navigation, we might need a reload here if the init script must run before initial load.
    // However, programmaticLoginWithRoutes uses page.goto('/') which triggers load.
    // I'll add the init script and then reload.
    await userPage.addInitScript(() => {
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

    // Reload to apply init scripts
    await userPage.reload();
    await userPage.waitForLoadState('networkidle');

    attachLiveTranscript(userPage);
    await userPage.setViewportSize({ width: 1280, height: 720 });

    const sessionPage = new SessionPage(userPage);
    debugLog('[TEST DEBUG] Navigating to session page...');
    await sessionPage.navigate(); // Uses navigateToRoute internally - preserves MSW context

    // Ensure E2E bridge is ready before proceeding
    debugLog('[TEST DEBUG] ⏳ Waiting for E2E bridge readiness...');
    await userPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

    debugLog('[TEST DEBUG] Checking start button state...');
    await expect(sessionPage.startButton).toBeEnabled({ timeout: 10000 });

    debugLog('[TEST DEBUG] Clicking start button...');
    await sessionPage.startButton.click({ timeout: 15000 });

    // Wait for speech recognition to be ready
    debugLog('[TEST DEBUG] Waiting for speech recognition to be active...');
    await userPage.waitForFunction(() => {
      return !!(window as Window & { __activeSpeechRecognition?: unknown }).__activeSpeechRecognition;
    }, null, { timeout: 10000 });

    // Verify that the UI updates to show the session is active
    debugLog('[TEST DEBUG] Waiting for session status indicator...');
    const sessionActiveIndicator = userPage.getByTestId('live-session-header');
    await expect(sessionActiveIndicator).toHaveText(/Recording active/);

    // The transcript container should show that we're listening
    debugLog('[TEST DEBUG] Waiting for transcript container to show "Listening..."...');
    const transcriptContainer = userPage.getByTestId('transcript-container');
    await expect(transcriptContainer).toContainText('Listening...', { timeout: 5000 });

    // Use the existing e2e-bridge infrastructure to dispatch a mock transcript
    debugLog('[TEST DEBUG] Dispatching mock transcript via window.dispatchMockTranscript...');

    await userPage.waitForFunction(() => typeof (window as unknown as { dispatchMockTranscript: unknown }).dispatchMockTranscript === 'function', null, { timeout: 30000 });

    // Robust Retry Loop: Dispatch and check for text
    await expect(async () => {
      await userPage.evaluate(() => {
        const win = window as Window & { dispatchMockTranscript?: (text: string, isFinal: boolean) => void };
        if (win.dispatchMockTranscript) {
          win.dispatchMockTranscript('This is a mock transcript.', true);
        }
      });
      // Short timeout for the check inside the loop
      await expect(transcriptContainer).toContainText('This is a mock transcript.', { timeout: 2000 });
    }).toPass({
      intervals: [1000, 2000, 5000],
      timeout: 30000
    });

    debugLog('[TEST DEBUG] ✅ Mock transcript appeared.');
  });
});
