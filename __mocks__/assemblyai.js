import { jest } from '@jest/globals';

const mockTranscriber = {
  on: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
};

export const AssemblyAI = jest.fn().mockImplementation(() => {
  return {
    RealtimeTranscriber: jest.fn().mockImplementation(() => mockTranscriber),
  };
});
