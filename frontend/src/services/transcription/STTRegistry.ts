import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import logger from '@/lib/logger';

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
    private registry: Map<string, EngineFactory> = new Map();

    private constructor() { }

    public static getInstance(): STTRegistry {
        if (!STTRegistry.instance) {
            STTRegistry.instance = new STTRegistry();
        }
        return STTRegistry.instance;
    }

    /**
     * Register a static instance for a specific mode/key (Test Compatibility).
     * Automatically wraps the instance in a factory.
     */
    public registerStatic(mode: string, instance: unknown): void {
        logger.debug({ mode }, '[STTRegistry] Registering static instance via factory wrapper');
        this.register(mode, (options) => {
            const inst = instance as Record<string, unknown>;
            if (options && inst && typeof inst === 'object' && 'updateOptions' in inst && typeof inst['updateOptions'] === 'function') {
                (inst['updateOptions'] as (o: unknown) => void)(options);
            }
            return instance as ITranscriptionEngine;
        });
    }

    /**
     * Register an engine factory for a specific mode/key.
     */
    public register(mode: string, factory: EngineFactory): void {
        logger.debug({ mode }, '[STTRegistry] Registering engine factory');
        this.registry.set(mode, factory);
    }

    /**
     * Retrieves an engine factory for the given mode.
     * Prioritizes the Window Bridge (E2E) then falls back to the local registry.
     */
    public get(mode: string): EngineFactory | undefined {
        // 1. Prioritize Window Bridge (Playwright/E2E Surgical Mocking)
        if (typeof window !== 'undefined') {
            const manifest = (window as unknown as { __SS_E2E__?: { registry?: Record<string, EngineFactory> } }).__SS_E2E__;
            if (manifest?.registry && manifest.registry[mode]) {
                logger.debug({ mode }, '[STTRegistry] Using surgical mock from window bridge');
                return manifest.registry[mode];
            }
        }

        // 2. Fallback to Registered Factory
        const factory = this.registry.get(mode);
        if (factory) {
            logger.info({ mode }, '[STTRegistry] Using registered factory');
            return factory;
        }

        return undefined;
    }

    /**
     * Clear all registered factories.
     */
    public clear(): void {
        this.registry.clear();
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
