import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import { TranscriptionPolicy } from './TranscriptionPolicy';
import { EngineFactory } from './EngineFactory';
import { NegotiatedStrategy } from './STTNegotiator';
import { getEngine } from '@/services/transcription/STTRegistry';
import { ENV } from '../../config/TestFlags';

/**
 * EngineSelector:
 * 
 * Boundary layer that enforces global resource guards and resolves the final execution path.
 * It is the ONLY layer allowed to access the STTRegistry.
 */
export class EngineSelector {
  /**
   * Selects and initializes the final engine instance based on the negotiated strategy.
   * Rationale: Centralizes T=0 mock resolution and production resource guarding.
   */
  public static async select(
    strategy: NegotiatedStrategy,
    options: TranscriptionModeOptions,
    policy: TranscriptionPolicy
  ): Promise<ITranscriptionEngine> {

    // 1. TEST PATH (Authoritative)
    // If the negotiator decided it's a mock path (due to environment), resolve it now.
    if (strategy.isMock) {
      const engineKey = strategy.variant || strategy.mode;
      const mockFactory = getEngine(engineKey);
      if (!mockFactory) {
        throw new Error(`[EngineSelector] Missing mock engine for key: ${engineKey} at T=0`);
      }
      return mockFactory(options);
    }

    // 2. RESOURCE GUARD (Production safety)
    // If WASM is disabled (e.g. CI safety), but negotiator didn't catch it, enforce fallback here.
    if (ENV.disableWasm) {
      const mockFactory = getEngine('mock');
      if (!mockFactory) {
        throw new Error('[EngineSelector] WASM disabled but no universal mock available in registry');
      }
      return mockFactory(options);
    }

    // 3. PRODUCTION PATH
    // Hand off to the pure factory for real engine construction.
    return EngineFactory.create(strategy.mode, options, policy);
  }
}
