import { STTStrategy } from './STTStrategy';
import { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import { TranscriptionModeOptions } from './modes/types';
import NativeBrowser from './modes/NativeBrowser';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import { PrivateSTT } from './engines/PrivateSTT';
import logger from '../../lib/logger';
import { ENV } from '../../config/TestFlags';
import { getEngine } from '@/services/transcription/STTRegistry';
import { IPrivateSTTEngine } from '../../contracts/IPrivateSTTEngine';

/**
 * ARCHITECTURE: STTStrategyFactory
 * Responsible for instantiating the correct STTStrategy based on the requested mode.
 */
export class STTStrategyFactory {
  /**
   * Creates a new STTStrategy instance.
   * Note: This factory does NOT initialize the strategy; it only constructs it.
   * Execution isolation is managed by TranscriptionService via serialized lifecycle.
   */
  public static create(
    mode: TranscriptionMode,
    options: TranscriptionModeOptions,
    _policy: TranscriptionPolicy
  ): STTStrategy {
    logger.info({ mode }, '[STTStrategyFactory] Creating strategy');

    const engineKey = this.getEngineKey(mode);
    logger.debug({ mode, engineKey, msg: '[STTStrategyFactory] Creating strategy' });
    const mockFactory = getEngine(engineKey);
    let mockEngine: IPrivateSTTEngine | undefined;

    if (mockFactory) {
      mockEngine = (mockFactory(options) as unknown) as IPrivateSTTEngine;
      logger.debug({ engineKey, hasCheckAvailability: !!mockEngine?.checkAvailability }, '[STTStrategyFactory] 🧪 Static Mock Resolved');
      
      // Strict Contract Check (Task 5.2)
      if (ENV.isTest && typeof mockEngine?.checkAvailability !== 'function') {
        throw new Error(`[STTStrategyFactory] 🚨 CONTRACT VIOLATION: Mock for "${engineKey}" must implement checkAvailability().`);
      }
    } else if (ENV.isTest) {
      logger.error({ engineKey }, '[STTStrategyFactory] 🚨 TEST MODE FAILURE: Missing mock for engine key');
      throw new Error(`[STTStrategyFactory] 🚨 TEST MODE FAILURE: Missing mock for engine key "${engineKey}". Deterministic mock resolution is mandatory.`);
    }

    let strategy: STTStrategy;

    switch (mode) {
      case 'native':
        strategy = new NativeBrowser(options, mockEngine) as unknown as STTStrategy;
        break;
      case 'cloud':
        strategy = new CloudAssemblyAI(options, mockEngine) as unknown as STTStrategy;
        break;
      case 'private':
        strategy = new PrivateSTT(options, mockEngine) as unknown as STTStrategy;
        break;
      default:
        throw new Error(`[STTStrategyFactory] Unsupported transcription mode: ${mode}`);
    }

    return strategy;
  }

  private static getEngineKey(mode: TranscriptionMode): string {
    switch (mode) {
      case 'native': return 'native-browser';
      case 'cloud': return 'assemblyai';
      case 'private': return 'whisper-turbo'; // Default for Private
      default: return 'unknown';
    }
  }
}
