// src/test/mocks/sharp.js
export default function mockSharp() {
  return {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image')),
    toFile: vi.fn().mockResolvedValue(),
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 })
  };
}
