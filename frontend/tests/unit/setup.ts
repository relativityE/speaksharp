import '@testing-library/jest-dom';
import { useSessionStore } from '../../src/stores/useSessionStore';
import TranscriptionService from '../../src/services/transcription/TranscriptionService';
import { beforeEach, vi } from 'vitest';
import { useProfile } from '../../src/hooks/useProfile';

// 1. Global useProfile Mock (Fixed: Ensure it covers all import styles and prevents context errors)
// Mock the absolute path and aliased path
vi.mock('@/hooks/useProfile', () => ({
    useProfile: vi.fn().mockReturnValue({
        id: 'mock-user-id',
        subscription_status: 'pro',
        email: 'test@example.com'
    })
}));

vi.mock('../../src/hooks/useProfile', () => ({
    useProfile: vi.fn().mockReturnValue({
        id: 'mock-user-id',
        subscription_status: 'pro',
        email: 'test@example.com'
    })
}));

vi.mock('../useProfile', () => ({
    useProfile: vi.fn().mockReturnValue({
        id: 'mock-user-id',
        subscription_status: 'pro',
        email: 'test@example.com'
    })
}));

// Polyfills for Radix UI components (DropdownMenu, Dialog, etc.)
if (typeof window !== 'undefined') {
    // PointerEvent polyfill
    if (!window.PointerEvent) {
        class PointerEvent extends MouseEvent {
            public pointerId: number;
            public pointerType: string;
            public isPrimary: boolean;
            constructor(type: string, params: PointerEventInit = {}) {
                super(type, params);
                this.pointerId = params.pointerId ?? 0;
                this.pointerType = params.pointerType ?? 'mouse';
                this.isPrimary = params.isPrimary ?? true;
            }
        }
        (window as unknown as Record<string, unknown>).PointerEvent = PointerEvent;
    }

    // ResizeObserver polyfill
    if (!window.ResizeObserver) {
        window.ResizeObserver = class ResizeObserver {
            observe() { }
            unobserve() { }
            disconnect() { }
        };
    }

    // SpeechRecognition Mock (Senior Architect)
    // Prevents "Native browser speech recognition not supported" errors in tests
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

    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
}

// ARCHITECTURE (Senior Architect):
// Ensure strict test isolation for global state.
// Since TranscriptionService is now a singleton and useSessionStore is global,
// we must reset them before each test to prevent state leaks.
beforeEach(() => {
    // Reset Zustand store to initialState
    useSessionStore.getState().resetSession();

    // Reset STT static failure tracking
    TranscriptionService.resetFailureCount();

    // Clear all mocks by default
    vi.clearAllMocks();
});
