// A simplified, dependency-free mock of the sharp API.
// This mock returns placeholder data and is intended to prevent type errors
// in the test environment where the real 'sharp' module is not available.

const sharp = () => {
  const sharpInstance = {
    resize: () => sharpInstance,
    toBuffer: async (): Promise<Buffer> => Buffer.from('mock-image-buffer'),
    jpeg: () => sharpInstance,
    png: () => sharpInstance,
    webp: () => sharpInstance,
    avif: () => sharpInstance,
    rotate: () => sharpInstance,
    flip: () => sharpInstance,
    flop: () => sharpInstance,
    sharpen: () => sharpInstance,
    blur: () => sharpInstance,
    gamma: () => sharpInstance,
    negate: () => sharpInstance,
    normalize: () => sharpInstance,
    toFile: async () => ({
      format: 'png',
      width: 100,
      height: 100,
      size: 1000,
    }),
    metadata: async () => ({
      width: 100,
      height: 100,
      format: 'png',
    }),
  };

  return sharpInstance;
};

// Mock static properties
Object.assign(sharp, {
  cache: () => {},
  concurrency: () => {},
  counters: () => ({ queue: 0, process: 0 }),
  simd: () => {},
  format: { jpeg: {}, png: {}, webp: {} },
  versions: { vips: 'mocked-vips', sharp: 'mocked-sharp' },
});

export default sharp;