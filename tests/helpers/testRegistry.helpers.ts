import type { Page } from '@playwright/test';

/**
 * Standard test implementations (commonly used in E2E)
 * Returns a factory string that can be eval'd in the browser context.
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
            return { isOk: false, error: new Error('Model failed to load') };
        },
        start: async () => { },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ isOk: false, error: new Error('Not implemented') }),
    }))()`,

    /**
     * Private STT with slow loading (for testing optimistic entry)
     */
    privateSTTSlow: (delayMs: number = 5000) => `(() => ({
        type: 'mock-slow',
        init: async () => {
            console.log('[SlowPrivateSTT] Simulating slow load:', ${delayMs}, 'ms');
            await new Promise(resolve => setTimeout(resolve, ${delayMs}));
            return { isOk: true, value: undefined };
        },
        start: async () => { },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ isOk: true, data: '' }),
    }))()`,

    /**
     * Native STT that produces specific transcripts
     */
    nativeSTTWithTranscript: (transcript: string) => `(() => ({
        type: 'mock-native',
        init: async () => ({ isOk: true, value: undefined }),
        start: async () => {
            console.log('[FakeNativeSTT] Emitting transcript:', ${JSON.stringify(transcript)});
        },
        stop: async () => { },
        destroy: async () => { },
        transcribe: async () => ({ isOk: true, data: ${JSON.stringify(transcript)} }),
    }))()`
};

/**
 * Registers a mock engine in the E2E environment using the T=0 Manifest pattern.
 */
export async function registerMockInE2E(
    page: Page,
    mode: 'native' | 'private' | 'cloud' | 'whisper-turbo' | 'transformers-js' | 'mock-engine',
    mockImplementationFactoryString: string
): Promise<void> {
    await page.addInitScript(
        ({ mode, factoryStr }) => {
            const win = window as unknown as Record<string, unknown>;
            
            // Initialize manifest if missing
            if (!win.__SS_E2E__) {
                const manifestInit = {
                    isActive: true,
                    engineType: 'mock',
                    registry: {},
                    flags: {}
                };
                (win as unknown as { __SS_E2E__: unknown }).__SS_E2E__ = manifestInit;
            }

            // Populate registry (SSOT)
            const factory = eval(factoryStr);
            const manifest = win.__SS_E2E__ as { registry: Record<string, unknown> };
            if (manifest.registry) {
                manifest.registry[mode] = factory;
            }
            
            console.log(`[E2E Help] Populated __SS_E2E__.registry.${mode}`);
        },
        {
            mode,
            factoryStr: mockImplementationFactoryString
        }
    );
}

/**
 * @deprecated - Registry is always enabled in E2E mode now.
 */
export async function enableTestRegistry(): Promise<void> {
    // No-op
}

export async function cleanupTestRegistry(page: Page): Promise<void> {
    await page.evaluate(() => {
        const win = window as unknown as Record<string, { registry?: Record<string, unknown> }>;
        if (win.__SS_E2E__) {
            win.__SS_E2E__.registry = {};
        }
    });
}
