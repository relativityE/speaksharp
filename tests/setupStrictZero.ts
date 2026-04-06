import { vi } from 'vitest';
import logger from '../frontend/src/lib/logger';

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
const minimalistMockFactory = () => {
  const mockEngine = {
    type: 'mock',
    instanceId: 'mock-instance-' + Math.random().toString(36).substring(7),
    init: vi.fn().mockImplementation(async (callbacks) => {
      Object.assign(mockEngine, callbacks);
      return { isOk: true };
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({ isOk: true, data: 'mock transcript' }),
    updateHeartbeat: vi.fn(),
    getEngineType: () => 'mock',
    getLastHeartbeatTimestamp: () => Date.now(),
    getTranscript: () => 'mock transcript',
    dispose: vi.fn(),
    onTranscriptUpdate: null as unknown as (update: unknown) => void,
    onModelLoadProgress: null as unknown as (progress: number | null) => void,
    onReady: null as unknown as () => void,
  };
  
  if (typeof window !== 'undefined') {
      const g = window as any;
      if (g.__SS_E2E__) g.__SS_E2E__.latestMock = mockEngine;
  }
  
  return mockEngine;
};

export async function setupStrictZero(options: { engineType?: string } = {}) {
  // 1. Reset module graph for deterministic T=0 initialization
  vi.resetModules();

  try {
      // ARCHITECTURE: Reach into any potentially cached version to reset invariant
      const factoryModule = await import('../frontend/src/services/transcription/STTStrategyFactory');
      const Factory = factoryModule.STTStrategyFactory;
      if (Factory) {
          Factory.ACTIVE_ENGINES_COUNT = 0;
          logger.info('[setupStrictZero] Invariant reset: ACTIVE_ENGINES_COUNT = 0');
      }
  } catch (e) {
      // If import fails, we might be in a different environment, but we must not swallow critical errors
      logger.error({ error: e }, '[setupStrictZero] Exception during STTStrategyFactory reset');
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
}
