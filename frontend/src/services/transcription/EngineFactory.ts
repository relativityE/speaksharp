import type { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import type { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import PrivateWhisper from './modes/PrivateWhisper';
import logger from '../../lib/logger';
import { getDefaultProviderEntry } from './providers/sttProviderConfig';
import type { PrivateSttProvider, SttMode, SttProviderEntry } from './providers/types';

/**
 * EngineFactory:
 * 
 * Pure construction layer that instantiates real production engines.
 * It has ZERO knowledge of test infrastructure or registries.
 */
export class EngineFactory {
  private static assertProviderAvailable(mode: SttMode, provider: SttProviderEntry): string {
    if (!provider.registryKey) {
      throw new Error(`[EngineFactory] Provider "${provider.id}" for mode "${mode}" is not available: no implementation is registered yet.`);
    }
    return provider.registryKey;
  }

  public static async create(
    mode: TranscriptionMode,
    options: TranscriptionModeOptions,
    _policy: TranscriptionPolicy
  ): Promise<ITranscriptionEngine> {

    // #1320: Private (on-device Whisper) is the only production engine. Native/Web-Speech is retired.
    if (mode !== 'private') {
      throw new Error(`[EngineFactory] Unsupported transcription mode: ${mode}`);
    }

    const provider = getDefaultProviderEntry(mode as SttMode);
    const providerId = provider.id;
    const registryKey = EngineFactory.assertProviderAvailable(mode as SttMode, provider);
    logger.info({ mode, provider: providerId, registryKey }, '[EngineFactory] Constructing production engine');

    return new PrivateWhisper({
      ...options,
      forceEngine: providerId as PrivateSttProvider,
    } as TranscriptionModeOptions);
  }
}
