// This module conditionally provides image manipulation capabilities.
// In a Node.js environment (like Vitest during tests), it exports the 'canvas' library.
// In a browser environment, it exports null as canvas operations are handled by the browser's native APIs.

import logger from './logger';

let imageProcessor;

if (import.meta.env.MODE === 'test') {
  // For the test environment, we use the node-canvas library for server-side image processing.
  try {
    imageProcessor = await import('canvas');
  } catch (e) {
    logger.error({ err: e }, '[imageProcessor] Failed to load "canvas" module in test mode.');
    imageProcessor = null;
  }
} else {
  // In the browser, we don't need a specific library as the browser provides the Canvas API.
  // We can set this to null or a mock object if needed.
  imageProcessor = null;
}

export default imageProcessor;