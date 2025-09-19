import { jest } from '@jest/globals';

export default function mockSharp() {
  return {
    resize: jest.fn<() => typeof this>(),
    jpeg: jest.fn<() => typeof this>(),
    png: jest.fn<() => typeof this>(),
    toBuffer: jest.fn<() => Promise<Buffer>>().mockResolvedValue(Buffer.from('mock-image')),
    toFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    metadata: jest.fn<() => Promise<{ width: number; height: number }>>().mockResolvedValue({ width: 100, height: 100 })
  };
}
