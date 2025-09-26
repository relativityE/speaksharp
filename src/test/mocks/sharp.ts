import Jimp from 'jimp/browser/lib/jimp.js';

// A simplified mock of the sharp API using Jimp
const sharp = (input: Buffer | string) => {
  const jimpPromise = typeof input === 'string' ? Jimp.read(input) : Jimp.read(input);

  const sharpInstance = {
    resize: (width: number, height: number) => {
      jimpPromise.then(image => image.resize(width, height));
      return sharpInstance;
    },

    toBuffer: async (): Promise<Buffer> => {
      const image = await jimpPromise;
      return image.getBufferAsync(Jimp.MIME_PNG); // Using PNG to avoid quality loss issues
    },

    // Replicating other chainable methods, even if they do nothing,
    // is important for code that calls them.
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

    toFile: async (path: string) => {
      const image = await jimpPromise;
      await image.writeAsync(path);
      return { format: 'png', width: image.getWidth(), height: image.getHeight(), size: 0 };
    },

    metadata: async () => {
      const image = await jimpPromise;
      return { width: image.getWidth(), height: image.getHeight(), format: 'png' };
    },
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
