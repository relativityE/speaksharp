import { vi, afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Environment variables for Supabase are now set in the test command in package.json
// to ensure they are available before any modules are imported.

// Mock SpeechRecognition API
const mockSpeechRecognition = vi.fn(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  onresult: null,
  onerror: null,
  onend: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

vi.stubGlobal('SpeechRecognition', mockSpeechRecognition);
vi.stubGlobal('webkitSpeechRecognition', mockSpeechRecognition);

// [Jules] The console is no longer suppressed so that all test output can be captured.

// AGGRESSIVE MOCKING - Mock everything that could cause memory leaks

const mockSupabase = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    signInAnonymously: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  from: vi.fn(),
  functions: {
    invoke: vi.fn(),
  },
};

// Default implementations
mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
mockSupabase.auth.onAuthStateChange.mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});

// Mock the chained query methods
const queryChainer = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: {}, error: null }),
  order: vi.fn().mockReturnThis(),
};

mockSupabase.from.mockReturnValue(queryChainer);

vi.mock('@/lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

// Mock React Router, but preserve key components for testing
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    // We DON'T mock useLocation, so that MemoryRouter can provide state correctly.
    // Let the actual implementation pass through.
  };
});

// Mock all external services aggressively
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    isFeatureEnabled: vi.fn(() => false),
  },
}));

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withErrorBoundary: (component) => component,
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({
    redirectToCheckout: vi.fn(() => Promise.resolve()),
    elements: vi.fn(),
  })),
}));

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
  Toaster: () => null,
}));

// Mock Audio APIs completely
class MockAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.state = 'running';
  }

  createMediaStreamSource() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  createScriptProcessor() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
  }

  createAnalyser() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 2048,
      getFloatTimeDomainData: vi.fn(),
    };
  }

  close() {
    return Promise.resolve();
  }
}

global.AudioContext = MockAudioContext;
global.webkitAudioContext = MockAudioContext;

// Mock MediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn(() => Promise.resolve({
      getTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }],
      getAudioTracks: () => [{ stop: vi.fn(), kind: 'audio', enabled: true }],
      getVideoTracks: () => [],
      addTrack: vi.fn(),
      removeTrack: vi.fn(),
      active: true,
    })),
  },
});

// Mock WebSocket completely
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;

    // Simulate immediate connection
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }

  send(data) {
    // Do nothing
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: 'Normal closure' });
    }
  }

  addEventListener(event, handler) {
    this[`on${event}`] = handler;
  }

  removeEventListener(event, handler) {
    this[`on${event}`] = null;
  }
}

global.WebSocket = MockWebSocket;

// Mock Worker
global.Worker = class MockWorker {
  constructor() {
    this.onmessage = null;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
  }
};

// AGGRESSIVE CLEANUP BETWEEN TESTS
let testCounter = 0;

beforeEach(() => {
  testCounter++;

  // Clear all mocks
  vi.clearAllMocks();

  // Force garbage collection more frequently
  if (testCounter % 3 === 0 && global.gc) {
    global.gc();
  }

  // Clear any intervals/timeouts
  vi.clearAllTimers();
});

afterEach(() => {
  // Perform cleanup after each test
  cleanup();

  // Clear all mocks to prevent test cross-contamination
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.clearAllTimers();

  // Force garbage collection to help manage memory, which was a historical issue
  if (global.gc) {
    global.gc();
  }
});
