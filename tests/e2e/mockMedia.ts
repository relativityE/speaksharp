import { Page } from '@playwright/test';

/**
 * Mocks the `navigator.mediaDevices.getUserMedia` function in the browser context.
 * This is necessary to bypass the browser's permission prompts and provide a fake media stream
 * for tests that involve audio recording. This is a "nuclear option" when Playwright's
 * built-in permission handling (`context.grantPermissions` or launch options) fails in a
 * specific test environment.
 *
 * @param page The Playwright page object.
 */
export async function mockGetUserMedia(page: Page) {
  await page.addInitScript(() => {
    // A mock MediaStream to return.
    let mockStream: MediaStream | null = null;

    // A helper to create a silent, fake audio stream.
    const createFakeStream = () => {
      if (mockStream) {
        return mockStream;
      }
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      mockStream = destination.stream;
      // Add a 'stop' method to the tracks to mimic a real MediaStreamTrack
      mockStream.getTracks().forEach(track => {
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          originalStop();
          // Also stop the oscillator and close the context to clean up resources.
          oscillator.stop();
          audioContext.close();
        };
      });
      return mockStream;
    };

    // Override the original getUserMedia function.
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
        // If audio is requested, return our fake stream.
        if (constraints?.audio) {
          return Promise.resolve(createFakeStream());
        }
        // If video or other constraints are requested, fall back to the original function.
        // This makes the mock more robust for other potential uses.
        if (typeof originalGetUserMedia === 'function') {
            return originalGetUserMedia(constraints);
        }
        // If there's no original to fall back to, reject the promise.
        return Promise.reject(new Error('getUserMedia mock: constraints not supported'));
      };
    }
  });
}
