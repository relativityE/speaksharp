import { jest } from '@jest/globals';

export default function mockSharp() {
  return {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-image')),
    toFile: jest.fn().mockResolvedValue(),
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 })
  };
}
