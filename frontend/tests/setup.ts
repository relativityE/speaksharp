import { beforeEach, afterEach, beforeAll, afterAll, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { WhisperEngineRegistry } from '@/services/transcription/engines/WhisperEngineRegistry';
import { server } from './support/mocks/server';
import { PORTS } from '../../scripts/build.config.js';

// Mock unified logger globally to prevent mock poisoning
vi.mock('@/lib/logger', () => {
    const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
    };
    // Senior Choice: explicit proxy for both default and named interop
    return {
        default: mockLogger,
        logger: mockLogger,
        __esModule: true,
    };
});

// ============================================
// CRITICAL: Hoist ALL mocks BEFORE any imports
// ============================================

// Mock Worker (infrastructure polyfill)
if (typeof window !== 'undefined') {
    (window as unknown as { Worker: unknown }).Worker = class MockWorker {
        constructor(public url: string) { }
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
        dispatchEvent = vi.fn().mockReturnValue(true);
    };
}

// Mock AudioProcessor (infrastructure polyfill)
vi.mock('@/services/transcription/utils/AudioProcessor', () => {
    return {
        floatToInt16: vi.fn().mockReturnValue(new Int16Array([100, 200])),
        floatToWav: vi.fn().mockReturnValue(new Uint8Array([0, 1, 2])),
        concatenateFloat32Arrays: vi.fn().mockImplementation((arrays: Float32Array[]) => {
            const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
            const result = new Float32Array(totalLength);
            let offset = 0;
            for (const arr of arrays) {
                result.set(arr, offset);
                offset += arr.length;
            }
            return result;
        }),
        AudioBuffer: vi.fn().mockImplementation(() => ({
            addSamples: vi.fn().mockReturnValue(null),
            flush: vi.fn().mockReturnValue(new Int16Array(0)),
            clear: vi.fn()
        })),
        downsampleAudio: vi.fn().mockImplementation(audio => audio),
        downsampleAudioAsync: vi.fn().mockImplementation(async audio => audio),
        floatToWavAsync: vi.fn().mockImplementation(async () => new Uint8Array(0)),
        floatToInt16Async: vi.fn().mockImplementation(async () => ({ result: new Int16Array(0), base64: '' }))
    };
});

// Mock heavy dependencies that trigger Worker chains
vi.mock('@/services/transcription/modes/PrivateWhisper', () => ({
    default: vi.fn().mockImplementation(() => ({
        init: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(''),
        terminate: vi.fn().mockResolvedValue(undefined)
    }))
}));

// Mock useProfile (Safe infrastructure mock)
vi.mock('@/hooks/useProfile', () => ({
    useProfile: vi.fn().mockReturnValue({
        profile: {
            id: 'mock-user-id',
            subscription_status: 'pro',
            email: 'test@example.com'
        },
        isVerified: true
    })
}));

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: vi.fn().mockReturnValue({
        data: {
            id: 'mock-user-id',
            subscription_status: 'pro'
        }
    })
}));

// Mock Toaster globally to prevent sonner mock collisions in tests and Happy-DOM stability issues
vi.mock('@/components/ui/sonner', () => ({
    Toaster: () => null
}));

// ============================================
// DOM Polyfills
// ============================================

if (typeof window !== 'undefined') {
    // IntersectionObserver — required by Embla Carousel, Radix UI tooltips
    class MockIntersectionObserver {
        root = null;
        rootMargin = '';
        thresholds: number[] = [];
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn().mockReturnValue([]);
    }
    global.IntersectionObserver = vi.fn().mockImplementation(
        () => new MockIntersectionObserver()
    ) as unknown as typeof IntersectionObserver;

    // ResizeObserver — required by Radix UI, Recharts
    class MockResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    }
    global.ResizeObserver = vi.fn().mockImplementation(
        () => new MockResizeObserver()
    ) as unknown as typeof ResizeObserver;

    // matchMedia — required by responsive components, media queries in hooks
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(), // Deprecated
            removeListener: vi.fn(), // Deprecated
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn().mockReturnValue(true),
        })),
    });

    // scrollTo — required by Embla Carousel
    window.scrollTo = vi.fn();

    // CSS.supports — required by some Radix primitives
    Object.defineProperty(window, 'CSS', {
        value: { supports: vi.fn().mockReturnValue(false) }
    });

    // PointerEvent polyfill
    if (!window.PointerEvent) {
        (window as unknown as { PointerEvent: unknown }).PointerEvent = class PointerEvent extends MouseEvent {
            public pointerId: number;
            public pointerType: string;
            public isPrimary: boolean;
            constructor(type: string, params: PointerEventInit = {}) {
                super(type, params);
                this.pointerId = params.pointerId ?? 0;
                this.pointerType = params.pointerType ?? 'mouse';
                this.isPrimary = params.isPrimary ?? true;
            }
        };
    }

    // SpeechRecognition Mock
    const MockSpeechRecognition = vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        onresult: null,
        onerror: null,
        onend: null,
        continuous: false,
        interimResults: false,
    }));
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = MockSpeechRecognition;

    // Audio & Media Polyfills
    (window as any).MediaStream = vi.fn().mockImplementation(() => ({
        getTracks: vi.fn().mockReturnValue([]),
        getAudioTracks: vi.fn().mockReturnValue([]),
        getVideoTracks: vi.fn().mockReturnValue([]),
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        clone: vi.fn().mockReturnThis(),
    }));

    (window as any).AudioContext = vi.fn().mockImplementation(() => ({
        createOscillator: vi.fn(),
        createGain: vi.fn(),
        close: vi.fn(),
        state: 'suspended',
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn().mockResolvedValue(undefined),
    }));
    (window as any).webkitAudioContext = (window as any).AudioContext;

    // URL polyfills for PDF generation (Necessary bridge for jsdom)
    if (typeof globalThis.URL.createObjectURL === 'undefined') {
        Object.defineProperty(globalThis.URL, 'createObjectURL', {
            value: vi.fn().mockReturnValue('blob:mock'),
            configurable: true
        });
    }
    if (typeof globalThis.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
            value: vi.fn(),
            configurable: true
        });
    }

    // Mock window.location for navigation tests (using centralized port config)
    Object.defineProperty(window, 'location', {
        writable: true,
        value: {
            ...window.location,
            assign: vi.fn(),
            replace: vi.fn(),
            reload: vi.fn(),
            href: `http://localhost:${PORTS.DEV}`,
            origin: `http://localhost:${PORTS.DEV}`,
            ancestorOrigins: {
                length: 0,
                contains: () => false,
                item: () => null
            },
            hash: '',
            host: `localhost:${PORTS.DEV}`,
            hostname: 'localhost',
            pathname: '/',
            port: String(PORTS.DEV),
            protocol: 'http:',
            search: '',
        },
    });

    // Mock environment variables for consistent testing
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_');
    vi.stubEnv('VITE_DEV_PREMIUM_ACCESS', 'false');
    // crypto.randomUUID polyfill (JSDOM requirement)
    if (typeof crypto === 'undefined' || !crypto.randomUUID) {
        Object.defineProperty(globalThis, 'crypto', {
            value: {
                randomUUID: () => {
                    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: any) =>
                        (c ^ (Uint8Array.from(window.crypto.getRandomValues(new Uint8Array(1)))[0] & (15 >> (c / 4)))).toString(16)
                    );
                },
                getRandomValues: (arr: any) => window.crypto.getRandomValues(arr)
            },
            configurable: true
        });
    }

    (window as any).__SS_E2E__ = {
        isActive: true,
        engineType: 'mock',
        registry: {},
        flags: {
            bypassMutex: true,
            fastTimers: true
        }
    };
}

// Import styles and jest-dom (safe)
import '@testing-library/jest-dom';

// ============================================
// Test Lifecycle Hooks
// ============================================

beforeAll(async () => {
    try {
        await server.listen({ onUnhandledRequest: 'warn' });
    } catch (error) {
        console.error('[MSW] Server failed to start:', error);
    }
});

afterAll(() => {
    server.close();
});

// Global error handling
const originalConsoleError = console.error;
beforeAll(() => {
    console.error = (...args: unknown[]) => {
        // Suppress known React warnings in test environment
        const message = args[0];
        if (
            typeof message === 'string' &&
            (
                message.includes('Warning: ReactDOM.render') ||
                message.includes('Warning: validateDOMNesting') ||
                message.includes('act()')
            )
        ) {
            return;
        }
        originalConsoleError.call(console, ...args);
    };
});

afterAll(() => {
    console.error = originalConsoleError;
});

beforeEach(async () => {
    vi.clearAllMocks();

    // Lazy load the store to prevent top-level poisoning
    const storeModule = await import('@/stores/useSessionStore');
    const useSessionStore = storeModule.useSessionStore;

    // Some tests mock useSessionStore locally; only reset if it's the real one or a compliant mock
    if (useSessionStore && typeof useSessionStore.getState === 'function') {
        const store = useSessionStore.getState() as { resetSession?: () => void };
        if (store && typeof store.resetSession === 'function') {
            store.resetSession();
        }
    }
});

afterEach(async () => {
    // 1. Clean up MSW
    server.resetHandlers();

    // 2. Clean up React DOM
    cleanup();

    // 3. Clear all mock calls/state
    vi.clearAllMocks();
    vi.clearAllTimers();

    // Reset DOM state safely
    if (typeof document !== 'undefined') {
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    }
});

/**
 * HEARTBEAT / TIMER STABILIZATION (E6-E7)
 * Rationale: CI timers are non-deterministic. Fake timers allow 
 * monotonic progression for heartbeat validation.
 */
export const useFakeTimersInTests = () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
};

// Auto-enable if manifest requests speed
if (typeof window !== 'undefined' && window.__SS_E2E__?.flags?.fastTimers) {
    useFakeTimersInTests();
}
