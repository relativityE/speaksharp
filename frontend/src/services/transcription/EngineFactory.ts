import type { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import type { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import NativeBrowser from './modes/NativeBrowser';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import { PrivateSTT } from './engines/PrivateSTT';
import logger from '../../lib/logger';

/**
 * EngineFactory:
 * 
 * Pure construction layer that instantiates real production engines.
 * It has ZERO knowledge of test infrastructure or registries.
 */
export class EngineFactory {
  public static async create(
    mode: TranscriptionMode,
    options: TranscriptionModeOptions,
    _policy: TranscriptionPolicy
  ): Promise<ITranscriptionEngine> {

    let engine: ITranscriptionEngine;

    logger.info({ mode }, '[EngineFactory] Constructing production engine');

    switch (mode) {
      case 'native':
        engine = new NativeBrowser(options);
        break;
      case 'cloud':
        engine = new CloudAssemblyAI(options);
        break;
      case 'private':
        // PrivateSTT is itself a facade that handles Whisper/TransformersJS
        engine = new PrivateSTT();
        break;
      default:
        throw new Error(`[EngineFactory] Unsupported transcription mode: ${mode}`);
    }

    return engine;
  }
}
