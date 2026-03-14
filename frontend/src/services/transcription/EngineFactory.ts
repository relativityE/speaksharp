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
        // 0. Static CI/Test Guard (Expert Recommendation: Prevent CI Hangs)
        if (typeof process !== 'undefined' && process.env?.STT_ENGINE === 'mock') {
            logger.info('[EngineFactory] 🧪 Static override: Injecting Mock engine');
            // We use a dynamic import for the mock to avoid bundling it in production
            const MockModule = await import('./engines/MockEngine');
            return new MockModule.MockEngine(options);
        }

        // 1. Registry Injection (Testing/Mocking) - TOP PRIORITY
        // Expert Recommendation: Check TestRegistry before any engine construction.
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            const registry = (win.__TEST_REGISTRY__ || testRegistry) as typeof testRegistry;
            const factory = registry.get<(opts: TranscriptionModeOptions) => ITranscriptionEngine>(mode);

            if (factory) {
                logger.info({ mode }, '[EngineFactory] 🧪 Injecting engine from Registry');
                return factory(options);
            }
        }

        const normalizedMode = mode.trim().toLowerCase() as TranscriptionMode;

        switch (normalizedMode) {
            case 'native': {
                logger.info('[EngineFactory] 🌐 Starting Native Browser mode');

                // PRIORITY 1: TestRegistry
                const nativeFactory = testRegistry.get<(opts: TranscriptionModeOptions) => ITranscriptionEngine>('native');
                if (nativeFactory) {
                    logger.info('[EngineFactory] 🧪 Injecting Native engine from Registry');
                    return nativeFactory(options);
                }

                return new NativeBrowser(options);
            }

            case 'cloud': {
                logger.info('[EngineFactory] ☁️ Starting Cloud (AssemblyAI) mode');

                // PRIORITY 1: TestRegistry
                const cloudFactory = testRegistry.get<(opts: TranscriptionModeOptions) => ITranscriptionEngine>('cloud');
                if (cloudFactory) {
                    logger.info('[EngineFactory] 🧪 Injecting Cloud engine from Registry');
                    return cloudFactory(options);
                }

                return new CloudAssemblyAI(options);
            }

            case 'private': {
                // PRIORITY 1: TestRegistry (Most Specific Injection)
                const factory = testRegistry.get<(options: TranscriptionModeOptions) => ITranscriptionEngine>('private');
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
