import type { Page } from '@playwright/test';
import type { TestRegistryInterface } from '../../frontend/src/services/transcription/TestRegistry';

declare global {
    interface Window {
        __TEST_REGISTRY__?: TestRegistryInterface;
    }
}

/**
 * Standard test implementations (commonly used)
 * Note: These are factories that return an implementation object.
 */
export const StandardMocks = {
    /**
     * Private STT that fails to load (for testing fallback)
     */
    privateSTTFailure: () => `(() => ({
        type: 'mock-failure',
        init: async () => {
            console.log('[FakePrivateSTT] Simulating load failure');
            await new Promise(resolve => setTimeout(resolve, 100));
            return { variant: 'Err', error: new Error('Model failed to load') };
        },
        start: async () => { },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ variant: 'Err', error: new Error('Not implemented') }),
    }))()`,

    /**
     * Private STT with slow loading (for testing optimistic entry)
     */
    privateSTTSlow: (delayMs: number = 5000) => `(() => ({
        type: 'mock-slow',
        init: async () => {
            console.log('[SlowPrivateSTT] Simulating slow load:', ${delayMs}, 'ms');
            await new Promise(resolve => setTimeout(resolve, ${delayMs}));
            return { variant: 'Ok', value: undefined };
        },
        start: async () => { },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ variant: 'Ok', value: '' }),
    }))()`,

    /**
     * Native STT that produces specific transcripts
     */
    nativeSTTWithTranscript: (transcript: string) => `(() => ({
        type: 'mock-native',
        init: async () => ({ variant: 'Ok', value: undefined }),
        start: async () => {
            console.log('[FakeNativeSTT] Emitting transcript:', ${JSON.stringify(transcript)});
        },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ variant: 'Ok', value: ${JSON.stringify(transcript)} }),
    }))()`
};

export async function registerMockInE2E(
    page: Page,
    mode: 'native' | 'private' | 'cloud' | 'whisper-turbo' | 'transformers-js' | 'mock-engine',
    mockImplementationFactoryString: string
): Promise<void> {
    // 1. Persist for future reloads (Synchronous Manifest Pattern)
    await page.addInitScript(
        ({ mode, factoryStr }) => {
            const key = `${mode}STT`;
            const factory = eval(factoryStr);
            const win = window as unknown as { 
                __SS_E2E__?: { 
                    isActive: boolean; 
                    engineType?: string; 
                    registry?: Record<string, unknown>;
                    flags?: Record<string, unknown>;
                } 
            };

            // Initialize manifest if missing
            if (!win.__SS_E2E__) {
                win.__SS_E2E__ = {
                    isActive: true,
                    engineType: 'mock',
                    registry: {},
                    flags: {}
                };
            }

            // 1. Direct Injection if Registry is already live
            const registryObj = (window as unknown as { __TEST_REGISTRY__?: { register: (m: string, f: unknown) => void } }).__TEST_REGISTRY__;
            if (registryObj) {
                registryObj.register(mode, factory);
                console.log('[E2E Help] Registered mock via live registry:', mode);
            } 
            
            // 2. Manifest Injection (SSOT)
            const registry = win.__SS_E2E__.registry;
            if (registry) {
                registry[key] = factory;
            }
            console.log('[E2E Help] Populated __SS_E2E__.registry for:', mode);
        },
        {
            mode,
            factoryStr: mockImplementationFactoryString
        }
    );
}

/**
 * Enable TestRegistry in E2E
 * @deprecated - Registry is always enabled in E2E mode now.
 */
export async function enableTestRegistry(): Promise<void> {
    // No-op for compatibility
}

/**
 * Disable and clear TestRegistry in E2E
 */
export async function cleanupTestRegistry(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (window.__TEST_REGISTRY__) {
            window.__TEST_REGISTRY__.clear();
        }
    });
}
