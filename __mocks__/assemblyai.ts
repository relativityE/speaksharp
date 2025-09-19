import { jest } from '@jest/globals';

const mockTranscriber = {
  on: jest.fn<() => void>(),
  start: jest.fn<() => void>(),
  stop: jest.fn<() => void>(),
};

export const AssemblyAI = jest.fn().mockImplementation(() => {
  return {
    RealtimeTranscriber: jest.fn().mockImplementation(() => mockTranscriber),
  };
});
