import type { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import { resolveMode } from './TranscriptionPolicy';
import { ENV } from '../../config/TestFlags';
import { syncSTTIdentity } from '../../lib/forensicAnchors';
import logger from '../../lib/logger';

/**
 * NegotiatedStrategy: 
 * The authoritative decision on how transcription will execute.
 */
export interface NegotiatedStrategy {
  /** The mode resolved from policy or overridden by test registry */
  mode: TranscriptionMode;
  /** Whether this is a mock execution path */
  isMock: boolean;
  /** The specific engine variant requested (e.g. 'private' might resolve to 'whisper-turbo') */
  variant?: string;
}

/**
 * STTNegotiator:
 * 
 * The Single Source of Truth for engine selection logic.
 * It negotiates between:
 * 1. User/Tier Policy (TranscriptionPolicy)
 * 2. Environment (ENV)
 */
export class STTNegotiator {
  /**
   * Negotiates the best strategy for the current context.
   * HARD GUARANTEE: ENV flags (disableWasm in tests) take absolute precedence.
   */
  public static negotiate(
    policy: TranscriptionPolicy,
    userPreference?: TranscriptionMode | null
  ): NegotiatedStrategy {
    // 2. Production Policy Resolution
    const resolvedMode = resolveMode(policy, userPreference);
    const result: NegotiatedStrategy = {
      mode: resolvedMode,
      isMock: ENV.isE2E && ENV.engineType === 'mock'
    };

    syncSTTIdentity(resolvedMode, result.isMock);
    logger.info({ mode: result.mode, isMock: result.isMock }, '[STTNegotiator] Decision');
    return result;
  }
}
