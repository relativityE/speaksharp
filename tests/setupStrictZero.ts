import { vi } from 'vitest';
import logger from '../frontend/src/lib/logger';
import { ITranscriptionEngine, TranscriptionModeOptions } from '../frontend/src/services/transcription/modes/types';

/**
 * ARCHITECTURE:
 * STRICT ZERO - T=0 Initialization Harness.
 * 
 * Rules:
 * 1. Reset module graph.
 * 2. Set globals (identity).
 * 3. Dynamic import components.
 */

// Local minimalist mock engine factory to avoid importing heavy WASM modules
const minimalistMockFactory = (options: TranscriptionModeOptions) => {
  const mockEngine = {
    type: 'mock',
    instanceId: 'mock-instance-' + Math.random().toString(36).substring(7),
    // ARCHITECTURE: init() no longer accepts callbacks (Step 5/6)
    init: vi.fn().mockImplementation(async () => {
      return { isOk: true, data: undefined };
    }),
    checkAvailability: vi.fn().mockResolvedValue({ isAvailable: true }),
    prepare: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockImplementation(async () => {
       // Simulate immediate ready if needed
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
    // Capture callbacks from options (Step 7)
    onTranscriptUpdate: options.onTranscriptUpdate,
    onModelLoadProgress: options.onModelLoadProgress,
    onReady: options.onReady,
  } as unknown as ITranscriptionEngine;
  
  if (typeof window !== 'undefined') {
      const g = window as unknown as Record<string, unknown>;
      if (g.__SS_E2E__) {
        const manifest = g.__SS_E2E__ as Record<string, unknown>;
        manifest.latestMock = mockEngine;
      }
  }
  
  return mockEngine;
};

export async function setupStrictZero(options: { engineType?: string } = {}) {
  // 1. Reset module graph for deterministic T=0 initialization
  vi.resetModules();

  try {
      // ARCHITECTURE: Use central registry to reset invariants
      const { sttRegistry } = await import('@/services/transcription/STTRegistry');
      if (sttRegistry) {
          sttRegistry.clear();
          logger.info('[setupStrictZero] Invariant reset: sttRegistry.clear()');
      }
  } catch (e) {
      logger.error({ error: e }, '[setupStrictZero] Exception during STTRegistry reset');
  }

  // 1.5 Clear shared browser state
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }

  // 2. Set globals BEFORE any imports
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.window === 'undefined') {
    g.window = g;
  }
  g.__TEST__ = true;
  g.__SS_E2E__ = {
    isActive: true,
    engineType: options.engineType || 'mock',
    registry: {
      'native-browser': minimalistMockFactory,
      'assemblyai': minimalistMockFactory,
      'whisper-turbo': minimalistMockFactory,
      'transformers-js': minimalistMockFactory
    }
  };

  // Register with the new SSOT Registry
  try {
      const { sttRegistry } = await import('@/services/transcription/STTRegistry');
      sttRegistry.register('native-browser', minimalistMockFactory);
      sttRegistry.register('assemblyai', minimalistMockFactory);
      sttRegistry.register('whisper-turbo', minimalistMockFactory);
      sttRegistry.register('transformers-js', minimalistMockFactory);
  } catch (e) {
      logger.error({ error: e }, '[setupStrictZero] Post-setup registry sync failed');
  }
}
