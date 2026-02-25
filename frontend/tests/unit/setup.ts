import { beforeEach, afterEach, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';

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

// Mock AudioProcessor (prevents Worker import chain)
vi.mock('@/services/transcription/utils/AudioProcessor', async () => {
    const testPath = expect.getState().testPath;
    if (testPath?.includes('AudioProcessor.test.ts')) {
        const actual = await vi.importActual('@/services/transcription/utils/AudioProcessor');
        return actual;
    }
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
vi.mock('@/hooks/useProfile', async () => {
    const testPath = expect.getState().testPath;
    // Bypass global mock if it's the specific unit test for this hook
    if (testPath?.match(/useProfile\.(test|component\.test)\.[tj]sx?$/)) {
        return await vi.importActual('@/hooks/useProfile');
    }
    return {
        useProfile: vi.fn().mockReturnValue({
            id: 'mock-user-id',
            subscription_status: 'pro',
            email: 'test@example.com'
        })
    };
});

vi.mock('@/hooks/useUserProfile', async () => {
    const testPath = expect.getState().testPath;
    // Bypass global mock if it's the specific unit test for this hook
    if (testPath?.match(/useUserProfile\.(test|component\.test)\.[tj]sx?$/)) {
        return await vi.importActual('@/hooks/useUserProfile');
    }
    return {
        useUserProfile: vi.fn().mockReturnValue({
            data: {
                id: 'mock-user-id',
                subscription_status: 'pro'
            }
        })
    };
});

// Mock Toaster globally to prevent sonner mock collisions in tests and Happy-DOM stability issues
vi.mock('@/components/ui/sonner', () => ({
    Toaster: () => null
}));

// ============================================
// DOM Polyfills
// ============================================

if (typeof window !== 'undefined') {
    // ResizeObserver polyfill
    global.ResizeObserver = class ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    };

    // Match media (Improved for sonner/radix compatibility)
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

afterEach(() => {
    cleanup();
});
