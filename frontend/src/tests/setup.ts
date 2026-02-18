import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

// Mock matchMedia for Radix UI and Sonner
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(), // deprecated
            removeListener: vi.fn(), // deprecated
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });

    // Mock IntersectionObserver for Radix UI
    class IntersectionObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        configurable: true,
        value: IntersectionObserver,
    });

    // Mock ResizeObserver for Radix UI and Embla Carousel
    class ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    }
    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        configurable: true,
        value: ResizeObserver,
    });

    // Mock MediaStream for tests
    class MockMediaStream {
        getTracks() { return []; }
        addTrack() { }
        removeTrack() { }
        clone() { return this; }
    }
    Object.defineProperty(window, 'MediaStream', {
        writable: true,
        configurable: true,
        value: MockMediaStream,
    });
}

// Mock URL methods for pdfGenerator
if (typeof window !== 'undefined') {
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();
}

afterEach(() => {
    vi.clearAllMocks();
});
