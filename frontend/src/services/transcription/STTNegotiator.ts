import type { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import { resolveMode } from './TranscriptionPolicy';
import { ENV } from '../../config/TestFlags';
import { syncSTTIdentity, syncNegotiatorDecision } from '../../lib/forensicAnchors';
import logger from '../../lib/logger';

/**
 * NegotiatedStrategy: 
 * The authoritative decision on how transcription will execute.
 */
export interface NegotiatedStrategy {
  /** The mode resolved from policy or overridden by test registry */
  mode: TranscriptionMode;
  /** Authoritative resolved mode for forensic signaling */
  resolvedMode: string;
  /** Whether this is a mock execution path */
  isMock: boolean;
  /** Execution source intent */
  source: string;
  /** The specific execution mode (e.g. 'mock' or the resolved mode) */
  executionMode: string;
  /** The specific engine variant requested (e.g. 'private' might resolve to 'transformers-js') */
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
    
    // Deterministic Execution Mode (Invariant I1)
    const executionMode = (ENV.isE2E && ENV.engineType === 'mock') ? 'mock' : resolvedMode;
    const source = policy.executionIntent || 'unknown';

    const result: NegotiatedStrategy = {
        mode: resolvedMode, // Compatibility
        resolvedMode,
        executionMode,
        isMock: executionMode === 'mock',
        source,
    };

    syncNegotiatorDecision(result.resolvedMode, result.isMock);

    syncSTTIdentity(resolvedMode, result.isMock);
    logger.info({ mode: result.mode, isMock: result.isMock }, '[STTNegotiator] Decision');
    return result;
  }
}
