import { vi } from 'vitest';
import { ITranscriptionEngine, TranscriptionModeOptions } from '../frontend/src/services/transcription/modes/types';

/**
 * ARCHITECTURE:
 * STRICT ZERO - T=0 Initialization Harness.
 */

const minimalistMockFactory = (options: TranscriptionModeOptions) => {
  const mockEngine = {
    type: 'mock',
    instanceId: 'mock-instance-' + Math.random().toString(36).substring(7),
    init: vi.fn().mockImplementation(async () => {
      return { isOk: true, data: undefined };
    }),
    checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
    prepare: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockImplementation(async () => {
       if (options.onReady) {
         const onReady = options.onReady as unknown as () => void;
         onReady();
       }
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({ isOk: true, data: 'mock transcript' }),
    updateHeartbeat: vi.fn(),
    getEngineType: () => 'mock',
    getLastHeartbeatTimestamp: () => Date.now(),
    getTranscript: vi.fn().mockResolvedValue('mock transcript'),
    dispose: vi.fn(),
    onTranscriptUpdate: options.onTranscriptUpdate,
    onModelLoadProgress: options.onModelLoadProgress,
    onReady: options.onReady,
  } as unknown as ITranscriptionEngine;
  
  return mockEngine;
};

export async function setupStrictZero(options: { engineType?: string } = {}) {
  // 1. Clear OLD registry BEFORE reset
  try {
      const { sttRegistry } = await import('../frontend/src/services/transcription/STTRegistry');
      if (sttRegistry) {
          sttRegistry.clear();
      }
  } catch (e) {
      console.error('[DIAGNOSTIC] Pre-reset clear failed', e);
  }

  // 2. Reset module graph
  vi.resetModules();

  // 3. Clear shared browser state
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }

  // 4. Set globals
  const g = globalThis as unknown as Record<string, unknown>;
  g.__TEST__ = true;
  g.__SS_E2E__ = {
    isActive: true,
    engineType: options.engineType || 'mock',
  };

  // 5. Register with the FRESH post-reset Registry
  try {
      const { sttRegistry } = await import('../frontend/src/services/transcription/STTRegistry');
      sttRegistry.register('native-browser', minimalistMockFactory);
      sttRegistry.register('assemblyai', minimalistMockFactory);
      sttRegistry.register('whisper-turbo', minimalistMockFactory);
      sttRegistry.register('transformers-js', minimalistMockFactory);
  } catch (e) {
      console.error('[DIAGNOSTIC] Post-setup registry sync failed', e);
  }
}
