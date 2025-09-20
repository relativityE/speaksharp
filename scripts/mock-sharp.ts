// TypeScript-friendly Sharp mock for development
// Run in dev with SKIP_SHARP=true

type SharpChainable = {
  resize: (...args: any[]) => SharpChainable;
  jpeg: (...args: any[]) => SharpChainable;
  png: (...args: any[]) => SharpChainable;
  webp: (...args: any[]) => SharpChainable;
  avif: (...args: any[]) => SharpChainable;
  rotate: (...args: any[]) => SharpChainable;
  flip: (...args: any[]) => SharpChainable;
  flop: (...args: any[]) => SharpChainable;
  sharpen: (...args: any[]) => SharpChainable;
  blur: (...args: any[]) => SharpChainable;
  gamma: (...args: any[]) => SharpChainable;
  negate: (...args: any[]) => SharpChainable;
  normalize: (...args: any[]) => SharpChainable;
  toBuffer: () => Promise<Buffer>;
  toFile: (path: string) => Promise<{ format: string; width: number; height: number }>;
  metadata: () => Promise<{ width: number; height: number; format: string }>;
};

const createSharpMock = (): SharpChainable => {
  const chain: any = {};
  const chainableMethods = [
    'resize', 'jpeg', 'png', 'webp', 'avif',
    'rotate', 'flip', 'flop', 'sharpen', 'blur', 'gamma', 'negate', 'normalize'
  ];

  chainableMethods.forEach((method) => {
    chain[method] = () => chain;
  });

  chain.toBuffer = async () => Buffer.from('mock-image');
  chain.toFile = async (path: string) => ({ format: 'jpeg', width: 100, height: 100 });
  chain.metadata = async () => ({ width: 100, height: 100, format: 'jpeg' });

  return chain;
};

// Static properties
const sharpMock = Object.assign(createSharpMock, {
  cache: (_: any) => {},
  concurrency: (_: number) => {},
  counters: () => ({ queue: 0, process: 0 }),
  simd: (_: boolean) => {},
  format: { jpeg: {}, png: {}, webp: {} },
  versions: { vips: '8.14.5', sharp: '0.33.1' },
});

export default sharpMock;
