// [JULES] This file is used to set up the test environment.
// We are adding back the jest-dom matchers for Vitest to provide
// more expressive, DOM-centric assertions.
import '@testing-library/jest-dom/vitest';

import { TextEncoder, TextDecoder } from 'util';

// Polyfills for browser-like APIs you may use
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder as any;

// Mocking Vite env vars
process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
process.env.VITE_SUPABASE_KEY = 'test-key';

// Mock scrollIntoView, which is not implemented in JSDOM.
// This prevents tests from crashing when a component calls it.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Mock window.matchMedia, which is not implemented in JSDOM.
// This is required by components that use responsive design queries (e.g. shadcn/ui components).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
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
