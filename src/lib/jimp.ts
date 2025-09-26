// This module acts as a wrapper for the 'jimp' library.
// It conditionally imports the correct version of Jimp based on the environment.
// In a Node.js environment (like Vitest during tests), it imports the standard 'jimp' package.
// In a browser environment, it imports the browser-specific build.

let jimp;

if (import.meta.env.MODE === 'test') {
  const jimpModule = await import('jimp');
  jimp = jimpModule.default;
} else {
  // The browser build of jimp is needed for client-side execution.
  // The browser build of jimp is needed for client-side execution.
  // We import without the .js extension, which is a common pattern for module resolution.
  const jimpModule = await import('jimp/browser/lib/jimp');
  jimp = jimpModule.default;
}

export default jimp;