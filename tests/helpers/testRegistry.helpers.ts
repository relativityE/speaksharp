import type { Page } from '@playwright/test';
import type { TestRegistryInterface } from '../../frontend/src/services/transcription/TestRegistry';
import type { SSE2EManifest } from '../../frontend/src/config/TestFlags';

declare global {
    interface Window {
        __TEST_REGISTRY__?: TestRegistryInterface;
        __SS_E2E__?: SSE2EManifest;
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
    mockImplementationFactoryString: string,
    options?: {
        testName?: string;
        priority?: number;
    }
): Promise<void> {
    // 1. Persist for future reloads (Synchronous Manifest Pattern)
    await page.addInitScript(
        ({ mode, factoryStr, opts }) => {
            const key = `${mode}STT`;
            const factory = eval(factoryStr);

            // Initialize manifest if missing
            window.__SS_E2E__ = window.__SS_E2E__ || {
                isActive: true,
                engineType: 'mock',
                registry: {},
                flags: {}
            };

            // 1. Direct Injection if Registry is already live
            if (window.__TEST_REGISTRY__) {
                window.__TEST_REGISTRY__.register(mode, factory);
                console.log('[E2E Help] Registered mock via live registry:', mode);
            } 
            
            // 2. Manifest Injection (SSOT)
            const registry = window.__SS_E2E__.registry as Record<string, unknown>;
            if (registry) {
                registry[key] = factory;
            }
            console.log('[E2E Help] Populated __SS_E2E__.registry for:', mode);
        },
        {
            mode,
            factoryStr: mockImplementationFactoryString,
            opts: options
        }
    );
}

/**
 * Enable TestRegistry in E2E
 * @deprecated - Registry is always enabled in E2E mode now.
 */
export async function enableTestRegistry(_page: Page): Promise<void> {
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
