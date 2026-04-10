import { vi } from 'vitest';
import { ITranscriptionEngine, Result } from '@/services/transcription/modes/types';

/**
 * CRITICAL IMPROVEMENT: Provide a base mock factory, not ad-hoc mocks.
 * This eliminates future breakage by enforcing the ITranscriptionEngine contract.
 */
export function createMockEngine(
  overrides?: Partial<ITranscriptionEngine>
): ITranscriptionEngine {
  return {
    checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),

    init: vi.fn().mockResolvedValue(Result.ok(undefined)),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),

    getTranscript: vi.fn().mockResolvedValue(''),
    getEngineType: vi.fn().mockReturnValue('mock'),
    getLastHeartbeatTimestamp: vi.fn(() => Date.now()),
    ...overrides,
  };
}
