import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import { EngineFactory } from './EngineFactory';
import { ENV } from '../../config/TestFlags';
import { createMockEngine } from './engines/mock/createMockEngine';

/**
 * EngineSelector:
 * 
 * Boundary layer that enforces global resource guards (WASM isolation)
 * BEFORE any engine-specific logic or imports are triggered.
 */
export class EngineSelector {
  /**
   * Selects and creates the designated engine.
   * HARD GUARANTEE: In test mode, this never touches real engines.
   */
  public static select(
    mode: TranscriptionMode,
    options: TranscriptionModeOptions,
    policy: TranscriptionPolicy
  ): ITranscriptionEngine | Promise<ITranscriptionEngine> {

    // 1. DETERMINISTIC BYPASS: CI/Test Resource Guard
    if (ENV.disableWasm) {
      return createMockEngine(options); // Constant-time, static instantiation
    }

    // 2. Production Hand-off: Delegate to Negotiator (EngineFactory)
    return EngineFactory.create(mode, options, policy);
  }
}
