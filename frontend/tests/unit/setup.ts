import { beforeEach, afterEach, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';

// ============================================
// CRITICAL: Hoist ALL mocks BEFORE any imports
// ============================================

// Mock Worker (infrastructure polyfill)
if (typeof window !== 'undefined') {
    (window as any).Worker = class MockWorker {
        constructor(public url: string) { }
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage = vi.fn();
        terminate = vi.fn();
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
        dispatchEvent = vi.fn().mockReturnValue(true);
    } as any;
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
        floatToWavAsync: vi.fn().mockImplementation(async samples => new Uint8Array(0)),
        floatToInt16Async: vi.fn().mockImplementation(async float32Array => ({ result: new Int16Array(0), base64: '' }))
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
        id: 'mock-user-id',
        subscription_status: 'pro',
        email: 'test@example.com'
    })
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

    // Match media
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    // PointerEvent polyfill
    if (!window.PointerEvent) {
        (window as any).PointerEvent = class PointerEvent extends MouseEvent {
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
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
}

// Import styles and jest-dom (safe)
import '@testing-library/jest-dom';

// ============================================
// Test Lifecycle Hooks
// ============================================

beforeEach(async () => {
    vi.clearAllMocks();
    // vi.useFakeTimers(); // Disabled globally to prevent userEvent timeouts. Use locally if needed.

    // Lazy load the store to prevent top-level poisoning
    const storeModule = await import('@/stores/useSessionStore');
    const useSessionStore = storeModule.useSessionStore;

    // Some tests mock useSessionStore locally; only reset if it's the real one or a compliant mock
    if (useSessionStore && typeof useSessionStore.getState === 'function') {
        const store = useSessionStore.getState();
        if (store && typeof (store as any).resetSession === 'function') {
            (store as any).resetSession();
        }
    }
});

afterEach(() => {
    cleanup();
    // vi.clearAllTimers();
});
