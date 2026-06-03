import type { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import type { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import NativeBrowser from './modes/NativeBrowser';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import PrivateWhisper from './modes/PrivateWhisper';
import logger from '../../lib/logger';
import { getDefaultProviderEntry } from './providers/sttProviderConfig';
import type { PrivateSttProvider, SttMode, SttProviderEntry } from './providers/types';
import { registerNativeProductionFormatter } from './modes/nativeGeminiFormatter';
import { registerNativeTranscriptFormatter } from './modes/nativeTranscriptFormatter';

/**
 * Activate (or clear) the API-backed saved-transcript formatter for the active
 * production engine. The formatter is Native ONLY:
 *   - native  -> register the Gemini `format-transcript` adapter
 *   - cloud   -> clear (Cloud has provider punctuation; must not depend on it)
 *   - private -> clear (Private formatting must stay local; never API)
 * Never throws — a formatter wiring failure must not block engine construction.
 * The seam itself falls back to the raw transcript if the backend is absent.
 */
function configureNativeFormatter(mode: SttMode): void {
  try {
    if (mode === 'native') {
      registerNativeProductionFormatter('native');
    } else {
      // Defensive: ensure no Native formatter lingers for cloud/private.
      registerNativeTranscriptFormatter(null);
    }
  } catch (error) {
    logger.warn({ error, mode }, '[EngineFactory] Native formatter activation skipped');
  }
}

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

    let engine: ITranscriptionEngine;

    if (mode !== 'native' && mode !== 'cloud' && mode !== 'private') {
      throw new Error(`[EngineFactory] Unsupported transcription mode: ${mode}`);
    }

    const provider = getDefaultProviderEntry(mode as SttMode);
    const providerId = provider.id;
    const registryKey = EngineFactory.assertProviderAvailable(mode as SttMode, provider);
    logger.info({ mode, provider: providerId, registryKey }, '[EngineFactory] Constructing production engine');

    // Native-only: wire (or clear) the API-backed saved-transcript formatter.
    configureNativeFormatter(mode as SttMode);

    switch (mode) {
      case 'native':
        if (registryKey !== 'native-browser') {
          throw new Error(`[EngineFactory] Native provider "${providerId}" is not wired to NativeBrowser.`);
        }
        engine = new NativeBrowser(options);
        break;
      case 'cloud':
        if (registryKey !== 'assemblyai') {
          throw new Error(`[EngineFactory] Cloud provider "${providerId}" is not available.`);
        }
        engine = new CloudAssemblyAI(options);
        break;
      case 'private':
        engine = new PrivateWhisper({
          ...options,
          forceEngine: providerId as PrivateSttProvider,
        } as TranscriptionModeOptions);
        break;
      default:
        throw new Error(`[EngineFactory] Unsupported transcription mode: ${mode}`);
    }

    return engine;
  }
}
