import { STTStrategy } from './STTStrategy';
import { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import { TranscriptionModeOptions } from './modes/types';
import NativeBrowser from './modes/NativeBrowser';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import { PrivateSTT } from './engines/PrivateSTT';
import logger from '@/lib/logger';
import { ENV } from '@/config/TestFlags';
import { getEngine } from './TestRegistry';
import { IPrivateSTTEngine } from '@/contracts/IPrivateSTTEngine';

/**
 * ARCHITECTURE: STTStrategyFactory
 * Responsible for instantiating the correct STTStrategy based on the requested mode.
 */
export class STTStrategyFactory {
  // Invariant: Hard architectural limits on concurrency.
  // Ensures mutual exclusion for instantiated transcription strategies across the process.
  public static ACTIVE_ENGINES_COUNT = 0;

  /**
   * Creates a new STTStrategy instance.
   * Note: This factory does NOT initialize the strategy; it only constructs it.
   */
  public static create(
    mode: TranscriptionMode,
    options: TranscriptionModeOptions,
    _policy: TranscriptionPolicy
  ): STTStrategy {
    logger.info({ mode }, '[STTStrategyFactory] Creating strategy');

    const engineKey = this.getEngineKey(mode);
    const mockFactory = getEngine(engineKey);
    let mockEngine: IPrivateSTTEngine | undefined;

    if (mockFactory) {
      mockEngine = (mockFactory(options) as unknown) as IPrivateSTTEngine;
    } else if (ENV.isTest) {
      // Step 2 & 4 Core Requirement: Fail fast if mock is missing in test mode
      throw new Error(`[STTStrategyFactory] 🚨 TEST MODE FAILURE: Missing mock for engine key "${engineKey}". Deterministic mock resolution is mandatory.`);
    }

    if (this.ACTIVE_ENGINES_COUNT > 0) {
      throw new Error(`[Invariant Violation] Concurrent engine initialization attempted. Strategy for ${mode} requested, but ${this.ACTIVE_ENGINES_COUNT} active strategies already exist in the global factory space.`);
    }

    this.ACTIVE_ENGINES_COUNT++;
    
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
        this.ACTIVE_ENGINES_COUNT--;
        throw new Error(`[STTStrategyFactory] Unsupported transcription mode: ${mode}`);
    }

    // Wrap the terminate function to maintain the concurrent engines invariant
    const originalTerminate = strategy.terminate.bind(strategy);
    strategy.terminate = async () => {
        try {
            await originalTerminate();
        } finally {
            STTStrategyFactory.ACTIVE_ENGINES_COUNT = Math.max(0, STTStrategyFactory.ACTIVE_ENGINES_COUNT - 1);
        }
    };

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
