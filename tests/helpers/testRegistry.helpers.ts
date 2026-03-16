import type { Page } from '@playwright/test';

declare global {
    interface Window {
        __TEST_REGISTRY__?: {
            register: (mode: string, factory: unknown, opts?: unknown) => void;
            enable: () => void;
            disable: () => void;
        };
        __TEST_REGISTRY_QUEUE__?: unknown[];
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
        async startTranscription(onTranscript: (update: unknown) => void) {
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
    mode: 'native' | 'private' | 'cloud' | 'whisper-turbo' | 'transformers-js' | 'mock-engine',
    mockImplementationFactoryString: string,
    options?: {
        testName?: string;
        priority?: number;
    }
): Promise<void> {
    // We pass the factory as a string because we can't easily serialize functions over the bridge
    // if they have closures. For simple factories, we can use eval or Function.

    // 1. Persist for future reloads
    await page.addInitScript(
        ({ mode, factoryStr, opts }) => {
            const key = `${mode}STT`;
            const registration = { key, factory: eval(factoryStr), opts };

            if (window.__TEST_REGISTRY__) {
                window.__TEST_REGISTRY__.register(mode, registration.factory, opts);
                console.log('[E2E Help] Registered mock for (init):', mode);
            } else {
                // Buffer for late hydration
                window.__TEST_REGISTRY_QUEUE__ = window.__TEST_REGISTRY_QUEUE__ || [];
                window.__TEST_REGISTRY_QUEUE__.push(registration);
                console.log('[E2E Help] Queued mock for (init):', mode);
            }
        },
        {
            mode,
            factoryStr: mockImplementationFactoryString,
            opts: options
        }
    );

    // 2. Apply IMMEDIATELY if page is open (Fixes Client-Side Nav issue)
    await page.evaluate(
        ({ mode, factoryStr, opts }) => {
            const key = `${mode}STT`;
            const registration = { key, factory: eval(factoryStr), opts };

            if (window.__TEST_REGISTRY__) {
                window.__TEST_REGISTRY__.register(mode, registration.factory, opts);
                console.log('[E2E Help] Registered mock for (immediate):', mode);
            } else {
                window.__TEST_REGISTRY_QUEUE__ = window.__TEST_REGISTRY_QUEUE__ || [];
                window.__TEST_REGISTRY_QUEUE__.push(registration);
                console.log('[E2E Help] Queued mock for (immediate):', mode);
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
        if (window.__TEST_REGISTRY__) {
            window.__TEST_REGISTRY__.enable();
        }
    });
}

/**
 * Disable and clear TestRegistry in E2E
 */
export async function cleanupTestRegistry(page: Page): Promise<void> {
    await page.evaluate(() => {
        if (window.__TEST_REGISTRY__) {
            window.__TEST_REGISTRY__.disable();
        }
    });
}
