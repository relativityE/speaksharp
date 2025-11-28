import { test, expect } from '@playwright/test';
import { SessionPage } from '../pom';
import { programmaticLogin, waitForE2EEvent, attachLiveTranscript } from './helpers';

test.describe.skip('Live Transcript Feature', () => {
  test('should display live transcript after session starts', async ({ page }) => {
    // Mock browser APIs BEFORE navigation to ensure they are available when the app loads
    // Only need to mock getUserMedia and AudioContext - SpeechRecognition is handled by e2e-bridge.ts
    await page.addInitScript(() => {
      console.log('[MOCK] Setting up media mocks...');

      // Mock getUserMedia
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: async () => {
            console.log('[MOCK] getUserMedia called - returning mock stream');
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).AudioContext = class MockAudioContext {
        audioWorklet = {
          addModule: async () => {
            console.log('[MOCK] audioWorklet.addModule called');
            return Promise.resolve();
          }
        };
        destination = {};

        constructor() {
          console.log('[MOCK] AudioContext created');
        }
        createMediaStreamSource() {
          console.log('[MOCK] createMediaStreamSource called');
          const chainable = {
            connect: () => chainable,
            disconnect: () => { }
          };
          return chainable;
        }
        createScriptProcessor() {
          console.log('[MOCK] createScriptProcessor called');
          return {
            connect: () => { },
            disconnect: () => { },
            onaudioprocess: null
          };
        }
        createGain() {
          console.log('[MOCK] createGain called');
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
      };

      // Mock AudioWorkletNode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).AudioWorkletNode = class MockAudioWorkletNode {
        port = {
          onmessage: null
        };
        connect() { return { connect: () => { } }; }
        disconnect() { }
        constructor() {
          console.log('[MOCK] AudioWorkletNode created');
        }
      };

      console.log('[MOCK] ✅ Media APIs (getUserMedia, AudioContext) mocked');
    });

    attachLiveTranscript(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await programmaticLogin(page);

    const sessionPage = new SessionPage(page);
    console.log('[TEST DEBUG] Navigating to session page...');
    await sessionPage.navigate();

    console.log('[TEST DEBUG] Checking start button state...');
    // We expect the button to be enabled now that we fixed the disabled logic
    // But it might still be disabled briefly while profile loads
    await expect(sessionPage.startButton).toBeEnabled({ timeout: 10000 });
    console.log('[TEST DEBUG] Start button is enabled.');

    console.log('[TEST DEBUG] Clicking start button...');
    await sessionPage.startButton.click({ timeout: 15000 });
    console.log('[TEST DEBUG] Start button clicked.');

    // Wait for speech recognition to be ready
    console.log('[TEST DEBUG] Waiting for e2e:speech-recognition-ready event...');
    await waitForE2EEvent(page, 'e2e:speech-recognition-ready');
    console.log('[TEST DEBUG] ✅ Speech recognition is ready.');

    // Verify that the UI updates to show the session is active
    console.log('[TEST DEBUG] Waiting for session status indicator...');
    const sessionActiveIndicator = page.getByTestId('session-status-indicator');
    await expect(sessionActiveIndicator).toHaveText('READY');
    console.log('[TEST DEBUG] Session status is READY.');

    // The transcript container should show that we're listening
    console.log('[TEST DEBUG] Waiting for transcript container to show "Listening..."...');
    const transcriptContainer = page.getByTestId('transcript-container');
    await expect(transcriptContainer).toContainText('Listening...', { timeout: 5000 });
    console.log('[TEST DEBUG] ✅ Transcript container shows "Listening...".');

    // Use the existing e2e-bridge infrastructure to dispatch a mock transcript
    console.log('[TEST DEBUG] Dispatching mock transcript via window.dispatchMockTranscript...');
    await page.evaluate(() => {
      // @ts-expect-error - dispatchMockTranscript is added by e2e-bridge.ts at runtime
      if (window.dispatchMockTranscript) {
        // @ts-expect-error - dispatchMockTranscript is added by e2e-bridge.ts at runtime
        window.dispatchMockTranscript('This is a mock transcript.', true);
      } else {
        console.error('[TEST] dispatchMockTranscript not found!');
      }
    });

    // Verify the transcript appears
    console.log('[TEST DEBUG] Waiting for mock transcript to appear...');
    await expect(transcriptContainer).toContainText('This is a mock transcript.', { timeout: 5000 });
    console.log('[TEST DEBUG] ✅ Mock transcript appeared.');
  });
});
