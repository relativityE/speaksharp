import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
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
    ): Promise<ITranscriptionMode> {
        // 1. Registry Injection (Testing/Mocking)
        // Check if a mock implementation is registered for this mode
        if (typeof window !== 'undefined' && 'window' in globalThis) {
            const win = window as unknown as Record<string, unknown>;
            if (win.__TEST_REGISTRY__) {
                // Fix untyped function call by casting first
                const registry = win.__TEST_REGISTRY__ as Map<TranscriptionMode, (opts: TranscriptionModeOptions) => ITranscriptionMode>;
                const factory = registry.get(mode);

                if (factory) {
                    const instance = factory(options); // Pass options to factory
                    return instance;
                }
            }
        }
        const normalizedMode = mode.trim().toLowerCase() as TranscriptionMode;

        switch (normalizedMode) {
            case 'native': {
                logger.info('[EngineFactory] 🌐 Starting Native Browser mode');

                // PRIORITY 1: TestRegistry
                const nativeFactory = testRegistry.get<() => ITranscriptionMode>('native');
                if (nativeFactory) {
                    logger.info('[EngineFactory] 🧪 Injecting Native engine from Registry');
                    return nativeFactory();
                }

                return new NativeBrowser(options);
            }

            case 'cloud': {
                logger.info('[EngineFactory] ☁️ Starting Cloud (AssemblyAI) mode');

                // PRIORITY 1: TestRegistry
                const cloudFactory = testRegistry.get<() => ITranscriptionMode>('cloud');
                if (cloudFactory) {
                    logger.info('[EngineFactory] 🧪 Injecting Cloud engine from Registry');
                    return cloudFactory();
                }

                return new CloudAssemblyAI(options);
            }

            case 'private': {
                // PRIORITY 1: TestRegistry (Most Specific Injection)
                const factory = testRegistry.get<(options: TranscriptionModeOptions) => ITranscriptionMode>('private');
                if (factory) {
                    logger.info('[EngineFactory] 🧪 Injecting Private engine from Registry');
                    return factory(options);
                }

                // PRIORITY 3: Real Implementation
                // Dynamic import to avoid circular dependencies if any, but also for code splitting
                const module = await import('./modes/PrivateWhisper');
                const instance = new module.default(options);
                logger.info({ engine: instance.getEngineType() }, '[EngineFactory] 🔒 Private Instance created');
                return instance;
            }

            default: {
                throw new Error(`Unknown transcription mode: "${mode}"`);
            }
        }
    }
}
