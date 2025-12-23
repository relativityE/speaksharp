import { vi } from 'vitest';

const mockTranscriber = {
  on: vi.fn<() => void>(),
  start: vi.fn<() => void>(),
  stop: vi.fn<() => void>(),
};

export const AssemblyAI = vi.fn().mockImplementation(() => {
  return {
    RealtimeTranscriber: vi.fn().mockImplementation(() => mockTranscriber),
  };
});

