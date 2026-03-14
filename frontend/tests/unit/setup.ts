import { beforeEach, afterEach, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { WhisperEngineRegistry } from '@/services/transcription/engines/WhisperEngineRegistry';
 
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
}

// Import styles and jest-dom (safe)
import '@testing-library/jest-dom';

// ============================================
// Test Lifecycle Hooks
// ============================================

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
    // 1. Clean up React DOM
    cleanup();

    // 2. Clear all mock calls/state
    vi.clearAllMocks();
    vi.clearAllTimers();

    // ✅ NOTE: WhisperEngineRegistry.reset() and vi.resetModules() are removed.
    // Each test file runs in its own process (maxForks: 1), ensuring 100% isolation
    // without the overhead of manual cache purging which can destabilize React 18.
});
