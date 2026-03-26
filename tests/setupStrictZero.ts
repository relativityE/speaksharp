import { vi } from 'vitest';

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
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue('mock transcript'),
    getTranscript: () => 'mock transcript',
    dispose: vi.fn(),
    onTranscriptUpdate: null as unknown as (update: unknown) => void,
    onModelLoadProgress: null as unknown as (progress: number | null) => void,
    onReady: null as unknown as () => void,
  };
  return mockEngine;
};

export async function setupStrictZero(options: { engineType?: string } = {}) {
  // 1. Reset module graph for deterministic T=0 initialization
  vi.resetModules();

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
      native: minimalistMockFactory,
      cloud: minimalistMockFactory,
      private: minimalistMockFactory
    }
  };
}
