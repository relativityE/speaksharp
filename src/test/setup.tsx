// src/test/setup.tsx - COMPLETE REWRITE
console.log("Executing setup.tsx");
import { vi, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// CRITICAL FIX 1: Complete, persistent Supabase mock that won't be cleared
const createPersistentSupabaseMock = () => {
  const mockAuth = {
    getSession: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: { session: null },
        error: null
      })
    ),
    onAuthStateChange: vi.fn().mockImplementation((callback) => {
      // Immediately call with initial state
      setTimeout(() => callback('INITIAL_SESSION', null), 0);
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn()
          }
        }
      };
    }),
    signUp: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: { user: null, session: null },
        error: null
      })
    ),
    signInWithPassword: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: { user: null, session: null },
        error: null
      })
    ),
    signInWithOtp: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: {},
        error: null
      })
    ),
    resetPasswordForEmail: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: {},
        error: null
      })
    ),
    signOut: vi.fn().mockImplementation(() =>
      Promise.resolve({ error: null })
    ),
    updateUser: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: { user: null },
        error: null
      })
    ),
    signInAnonymously: vi.fn().mockImplementation(() =>
      Promise.resolve({
        data: { session: { access_token: 'mock-token' } },
        error: null
      })
    )
  };

  const createMockQueryBuilder = () => {
    const builder = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: vi.fn().mockResolvedValue({ data: [], error: null }), // Make it thenable
    };
    // Make the builder itself a promise-like object
    builder.then.mockImplementation((onFulfilled) => Promise.resolve({ data: [], error: null }).then(onFulfilled));
    return builder;
  };

  const mockFrom = vi.fn().mockImplementation(() => createMockQueryBuilder());

  const mockFunctions = {
    invoke: vi.fn().mockResolvedValue({
      data: { token: 'mock-assemblyai-token' },
      error: null
    })
  };

  return {
    auth: mockAuth,
    from: mockFrom,
    functions: mockFunctions
  };
};

// Create the mock instance once
const persistentSupabaseMock = createPersistentSupabaseMock();

// CRITICAL: Mock with a factory that returns the same instance
vi.mock('@/lib/supabaseClient', () => ({
  supabase: persistentSupabaseMock
}), { hoisted: true });

// Mock other critical dependencies

// Mock sharp to prevent installation errors in test environments
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image')),
    toFile: vi.fn().mockResolvedValue(),
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 })
  }))
}), { hoisted: true });

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  },
  Toaster: () => null
}), { hoisted: true });

// Mock PostHog to prevent network calls
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn()
  }
}), { hoisted: true });

// Mock the speech recognition hook to prevent hanging
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    isReady: false,
    transcript: '',
    error: null,
    isSupported: true,
    mode: null,
    chunks: [],
    interimTranscript: '',
    fillerData: {},
    modelLoadingProgress: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    reset: vi.fn()
  }))
}), { hoisted: true });

// Mock Browser APIs not present in JSDOM
Object.defineProperty(window, 'SpeechRecognition', {
  value: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    onresult: null,
    onerror: null,
  })),
  writable: true,
});
Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      onresult: null,
      onerror: null,
    })),
    writable: true,
});
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(null),
  },
  writable: true,
});

// Mock URL.createObjectURL for tests that use it (e.g., for downloading files)
Object.defineProperty(window.URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(window.URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

// Global error handler to catch unhandled promises
let unhandledRejections = [];

const handleUnhandledRejection = (event) => {
  unhandledRejections.push(event.reason);
  console.warn('Unhandled promise rejection in test:', event.reason);
};

beforeEach(() => {
  // Reset unhandled rejections tracker
  unhandledRejections = [];

  // Add rejection handler
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
  }

  // Reset mock call history but preserve implementations
  Object.values(persistentSupabaseMock.auth).forEach(fn => {
    if (vi.isMockFunction(fn)) {
      fn.mockClear();
    }
  });

  // Ensure clean DOM
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

afterEach(() => {
  // Remove rejection handler
  if (typeof window !== 'undefined') {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }

  // Check for unhandled rejections and warn
  if (unhandledRejections.length > 0) {
    console.warn(`Test ended with ${unhandledRejections.length} unhandled promise rejections`);
  }

  // Cleanup React
  cleanup();

  // Final DOM cleanup
  document.body.innerHTML = '';
});
