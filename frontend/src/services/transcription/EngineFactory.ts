import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import { TranscriptionMode, TranscriptionPolicy } from './TranscriptionPolicy';
import NativeBrowser from './modes/NativeBrowser';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import { testRegistry } from './TestRegistry';
import logger from '../../lib/logger';

/**
 * Factory for creating transcription engines.
 * Encapsulates the logic for selecting the correct engine based on mode and configuration.
 */
export class EngineFactory {
    /**
     * Create an engine instance based on the mode and configuration.
     */
    public static async create(
        mode: TranscriptionMode,
        options: TranscriptionModeOptions,
        _policy: TranscriptionPolicy
    ): Promise<ITranscriptionEngine> {
        // 1. Registry Injection (Strict Zero) - TOP PRIORITY
        const engineFactory = testRegistry.get(mode);
        if (engineFactory) {
            logger.info({ mode }, '[EngineFactory] 🧪 Injecting engine from Registry');
            return engineFactory(options);
        }

        const normalizedMode = mode.trim().toLowerCase() as TranscriptionMode;

        switch (normalizedMode) {
            case 'native':
                logger.info('[EngineFactory] 🌐 Starting Native Browser mode');
                return new NativeBrowser(options);

            case 'cloud':
                logger.info('[EngineFactory] ☁️ Starting Cloud (AssemblyAI) mode');
                return new CloudAssemblyAI(options);

            case 'private': {
                // Dynamic import to avoid circular dependencies if any, but also for code splitting
                const module = await import('./modes/PrivateWhisper');
                const instance = new module.default(options);
                logger.info({ engine: instance.getEngineType() }, '[EngineFactory] 🔒 Private Instance created');
                return instance;
            }

            default:
                throw new Error(`Unknown transcription mode: "${mode}"`);
        }
    }
}
