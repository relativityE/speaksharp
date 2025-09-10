// src/test/setup.ts - Updated with MSW integration
import { expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { server } from './mocks/server';

vi.mock('./lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

// Extend Vitest's expect with Testing Library matchers
expect.extend(matchers);

// Start MSW server before all tests
beforeAll(async () => {
  console.log('[MSW] About to start server...');
  try {
    await server.listen({
      onUnhandledRequest: 'warn',
    });
    console.log('[MSW] Server started successfully');
  } catch (error) {
    console.log('[MSW] Server failed to start:', error);
  }
});

// Reset handlers and cleanup after each test
afterEach(() => {
  console.log('[TEST SETUP] afterEach: Cleaning up...');
  server.resetHandlers();
  cleanup();
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.resetModules();

  // Reset DOM state
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

// Close server after all tests
afterAll(() => {
  console.log('[TEST SETUP] afterAll: Closing MSW server...');
  server.close();
});

// Mock browser APIs that tests depend on
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

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock Web Speech API
Object.defineProperty(window, 'webkitSpeechRecognition', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    continuous: false,
    interimResults: false,
    lang: 'en-US',
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onaudiostart: null,
    onaudioend: null,
    onend: null,
    onerror: null,
    onnomatch: null,
    onresult: null,
    onsoundstart: null,
    onsoundend: null,
    onspeechstart: null,
    onspeechend: null,
    onstart: null,
  })),
});

Object.defineProperty(window, 'SpeechRecognition', {
  writable: true,
  value: window.webkitSpeechRecognition,
});

// Mock getUserMedia for audio testing
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
          kind: 'audio',
          enabled: true,
        }
      ],
    }),
    enumerateDevices: vi.fn().mockResolvedValue([
      {
        deviceId: 'default',
        kind: 'audioinput',
        label: 'Default - Test Microphone',
        groupId: 'test-group-1',
      },
    ]),
  },
});

// Mock Audio Context
global.AudioContext = vi.fn().mockImplementation(() => ({
  createAnalyser: vi.fn(() => ({
    frequencyBinCount: 1024,
    fftSize: 2048,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
  })),
  createMediaStreamSource: vi.fn(() => ({
    connect: vi.fn(),
  })),
  close: vi.fn(),
  resume: vi.fn().mockResolvedValue(undefined),
  suspend: vi.fn().mockResolvedValue(undefined),
  state: 'running',
}));

// Mock window.location for navigation tests
delete (window as any).location;
window.location = {
  ...window.location,
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
  href: 'http://localhost:5173',
  origin: 'http://localhost:5173',
};

// Mock environment variables for consistent testing
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_');
vi.stubEnv('VITE_DEV_PREMIUM_ACCESS', 'false');
vi.stubEnv('VITE_TEST_MODE', 'true');

// Global error handling
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
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

// Global test utilities
declare global {
  var TEST_MODE: boolean;
}

global.TEST_MODE = true;
