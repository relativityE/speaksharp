import type { Page } from '@playwright/test';

/**
 * Standard test implementations (commonly used)
 * Note: These are factories that return an implementation object.
 */
export const StandardMocks = {
    /**
     * Private STT that fails to load (for testing fallback)
     */
    privateSTTFailure: () => ({
        async init() {
            console.log('[FakePrivateSTT] Simulating load failure');
            await new Promise(resolve => setTimeout(resolve, 100));
            throw new Error('Model failed to load');
        },
        async transcribe() {
            return { isErr: true, error: new Error('Cannot transcribe - not initialized') };
        },
        async destroy() { },
        getEngineType: () => 'mock-failure'
    }),

    /**
     * Private STT with slow loading (for testing optimistic entry)
     */
    privateSTTSlow: (delayMs: number = 5000) => ({
        async init() {
            console.log('[SlowPrivateSTT] Simulating slow load:', delayMs, 'ms');
            await new Promise(resolve => setTimeout(resolve, delayMs));
        },
        async transcribe() {
            return { isErr: false, value: 'Slow mock transcript' };
        },
        async destroy() { },
        getEngineType: () => 'mock-slow'
    }),

    /**
     * Native STT that produces specific transcripts
     */
    nativeSTTWithTranscript: (transcript: string) => ({
        async init() { },
        async startTranscription(onTranscript: (update: any) => void) {
            console.log('[FakeNativeSTT] Emitting transcript:', transcript);
            setTimeout(() => onTranscript({ transcript: { text: transcript, isFinal: true } }), 100);
        },
        async stopTranscription() { return transcript; },
        async destroy() { },
        getEngineType: () => 'mock-native'
    })
};

/**
 * Register mock in E2E test (Playwright)
 */
export async function registerMockInE2E(
    page: Page,
    mode: 'native' | 'private' | 'cloud',
    mockImplementationFactoryString: string,
    options?: {
        testName?: string;
        priority?: number;
    }
): Promise<void> {
    // We pass the factory as a string because we can't easily serialize functions over the bridge
    // if they have closures. For simple factories, we can use eval or Function.
    await page.addInitScript(
        ({ mode, factoryStr, opts }) => {
            if ((window as any).__TEST_REGISTRY__) {
                const factory = eval(factoryStr);
                (window as any).__TEST_REGISTRY__.register(mode, factory, opts);
                console.log('[E2E Help] Registered mock for:', mode);
            }
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
 */
export async function enableTestRegistry(page: Page): Promise<void> {
    await page.addInitScript(() => {
        if ((window as any).__TEST_REGISTRY__) {
            (window as any).__TEST_REGISTRY__.enable();
        }
    });
}

/**
 * Disable and clear TestRegistry in E2E
 */
export async function cleanupTestRegistry(page: Page): Promise<void> {
    await page.evaluate(() => {
        if ((window as any).__TEST_REGISTRY__) {
            (window as any).__TEST_REGISTRY__.disable();
        }
    });
}
