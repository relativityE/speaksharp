import { createMockEngine } from '../engines/mock/createMockEngine';

/**
 * ARCHITECTURE:
 * Zero-Policing Test Harness.
 * Standardizes the T=0 Manifest to ensure all tests use the SSOT MockEngine registry.
 * 
 * DESIGN RATIONALE:
 * This ensures that behavior derivation (ENV) remains pure while the 
 * orchestration layer (Manifest) provides the necessary mocks for CI isolation.
 */
export function setupMockEnv() {
  // 1. Force unit test identity
  globalThis.__TEST__ = true;

  // 2. Inject canonical mock registry at T=0
  // Every mode is mapped to the canonical createMockEngine factory.
  window.__SS_E2E__ = {
    isActive: true,
    engineType: 'mock',
    registry: {
      native: createMockEngine,
      cloud: createMockEngine,
      private: createMockEngine
    }
  };
}
