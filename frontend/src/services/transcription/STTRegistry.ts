import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import logger from '../../lib/logger';

/**
 * ARCHITECTURE: STTRegistry
 * 
 * Central registry for STT engine factories. This serves as the 
 * environment-agnostic lookup mechanism for both Production and Test modes.
 * 
 * Rules:
 * 1. Mutual Exclusion: Managed by TranscriptionService lifecycle (await terminate).
 * 2. Deterministic Resolution: Prioritizes explicitly registered mocks.
 * 3. Identity Parity: registerStatic() ensures tests and services share the same object.
 */

export type EngineFactory = (options: TranscriptionModeOptions) => ITranscriptionEngine;

class STTRegistry {
    private static instance: STTRegistry;
    public readonly identityId = Math.random().toString(36).substring(7);
    private registry: Map<string, EngineFactory> = new Map();
    private staticRegistry: Map<string, ITranscriptionEngine> = new Map();
    
    private constructor() {}

    public static getInstance(): STTRegistry {
        if (!STTRegistry.instance) {
            STTRegistry.instance = new STTRegistry();
        }
        return STTRegistry.instance;
    }

    /**
     * Register a static instance for a specific mode (Testing ONLY).
     * This ensures identity parity between test code and service code.
     */
    public registerStatic(mode: string, instance: ITranscriptionEngine): void {
        logger.debug({ mode }, '[STTRegistry] Registering static instance');
        this.staticRegistry.set(mode, instance);
    }

    /**
     * Register an engine factory for a specific mode/key.
     */
    public register(mode: string, factory: EngineFactory): void {
        logger.debug({ mode }, '[STTRegistry] Registering engine factory');
        this.registry.set(mode, factory);
    }

    /**
     * Retrieves an engine for the given mode.
     * Hardened to return an Option-Aware Factory that preserves sanitization.
     */
    public get(mode: string): EngineFactory | undefined {
        console.error('[DIAGNOSTIC] Registry.get requested key:', mode, 'Available:', Array.from(this.registry.keys()));
        const staticInstance = this.staticRegistry.get(mode);
        if (staticInstance) {
            return (options) => {
                if (options) {
                    // 1. Dynamic Injection via Contract Hook
                    const engineWithHook = staticInstance as unknown as { 
                        updateOptions: (opts: Partial<TranscriptionModeOptions>) => void 
                    };
                    if ('updateOptions' in staticInstance && typeof engineWithHook.updateOptions === 'function') {
                        engineWithHook.updateOptions(options);
                    } else {
                        // 2. Fallback Wiring (Direct Callback Injection)
                        const rawEngine = staticInstance as unknown as Record<string, unknown>;
                        if (options.onTranscriptUpdate && 'onTranscriptUpdate' in staticInstance) {
                            rawEngine.onTranscriptUpdate = options.onTranscriptUpdate;
                        }
                        if (options.onError && 'onError' in staticInstance) {
                            rawEngine.onError = options.onError;
                        }
                        if (options.onStatusChange && 'onStatusChange' in staticInstance) {
                            rawEngine.onStatusChange = options.onStatusChange;
                        }
                    }
                }
                return staticInstance;
            };
        }

        const factory = this.registry.get(mode);
        if (factory) {
            logger.info({ mode }, '[STTRegistry] Using registered factory');
            return factory;
        }

        return undefined;
    }

    /**
     * Clear all registered factories and static instances.
     */
    public clear(): void {
        this.registry.clear();
        this.staticRegistry.clear();
        logger.debug('[STTRegistry] Registry cleared');
    }
}

export const sttRegistry = STTRegistry.getInstance();

export function getEngine(mode: string): EngineFactory | undefined {
    return sttRegistry.get(mode);
}

export function getEngineType(): string | undefined {
    if (typeof window !== 'undefined') {
        const manifest = (window as unknown as { __SS_E2E__?: { engineType?: string } }).__SS_E2E__;
        return manifest?.engineType;
    }
    return undefined;
}
