import { vi } from 'vitest';

// This is a mock for the 'sharp' module.
// It is used to prevent the actual 'sharp' module from being loaded during tests,
// as it contains native code that can cause issues in a test environment.

const sharp = vi.fn().mockImplementation(() => ({
  resize: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image')),
  toFile: vi.fn().mockResolvedValue(undefined),
  metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
}));

export default sharp;
