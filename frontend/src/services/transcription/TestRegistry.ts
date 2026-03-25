/**
 * STRICT ZERO: Synchronous Test Registry.
 * 
 * At T=0, all engines MUST be available in the window.__SS_E2E__.registry.
 * This eliminates the "STT_ENGINE_MISSING" race condition.
 */

import { ITranscriptionEngine, TranscriptionModeOptions } from './modes/types';
import '@/config/TestFlags';

/**
 * Type-safe interface for the test registry
 */
export interface TestRegistryInterface {
    get: typeof getEngine;
    has: (mode: string) => boolean;
    clear: () => void;
    register: (mode: string, factory: (options: TranscriptionModeOptions) => ITranscriptionEngine) => void;
}

/**
 * Retrieves an engine factory from the synchronous manifest.
 * No queues. No fallbacks. No merging.
 */
export function getEngine(mode: string): ((options: TranscriptionModeOptions) => ITranscriptionEngine) | undefined {
    if (typeof window === 'undefined' || !window.__SS_E2E__?.registry) return undefined;
    
    const factory = window.__SS_E2E__.registry[mode];
    return factory as ((options: TranscriptionModeOptions) => ITranscriptionEngine) | undefined;
}

// Deprecated: Exporting a compatible object for legacy call-sites 
// during the transition, but marked for short-term deletion.
export const testRegistry = {
    get: getEngine,
    has: (mode: string) => !!getEngine(mode),
    clear: () => {
        if (typeof window !== 'undefined' && window.__SS_E2E__) {
            window.__SS_E2E__.registry = {};
        }
    },
    register: (mode: string, factory: (options: TranscriptionModeOptions) => ITranscriptionEngine) => {
        if (typeof window !== 'undefined') {
            if (!window.__SS_E2E__) {
                window.__SS_E2E__ = { 
                    isActive: true, 
                    engineType: 'mock', 
                    registry: {},
                    flags: {
                        bypassMutex: false,
                        fastTimers: false
                    }
                };
            }
            if (!window.__SS_E2E__.registry) {
                window.__SS_E2E__.registry = {};
            }
            window.__SS_E2E__.registry[mode] = factory;
        }
    }
};

// Canonical Registration (Determinisic)
import { createMockEngine } from './engines/mock/createMockEngine';
testRegistry.register('mock', createMockEngine);
