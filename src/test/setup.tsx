import { vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Track all mocked objects for cleanup
const mockedObjects = new Set();
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Suppress noise in tests but catch real errors
console.error = (...args) => {
  const message = args[0]?.toString() || '';
  if (!message.includes('Warning:') && !message.includes('[CloudAssemblyAI]')) {
    originalConsoleError(...args);
  }
};

console.warn = (...args) => {
  const message = args[0]?.toString() || '';
  if (!message.includes('Warning:')) {
    originalConsoleWarn(...args);
  }
};

// AGGRESSIVE MOCKING - Mock everything that could cause memory leaks

// Mock Supabase completely
const mockSupabase = {
  auth: {
    signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
    signUp: vi.fn(() => Promise.resolve({ error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    signInAnonymously: vi.fn(() => Promise.resolve({
      data: { session: { access_token: 'mock-token' } },
      error: null
    })),
    getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => {
      const unsubscribe = vi.fn();
      return { data: { subscription: { unsubscribe } } };
    }),
  },
  functions: {
    invoke: vi.fn(() => Promise.resolve({ data: { token: 'mock-token' }, error: null })),
  },
};

vi.mock('./lib/supabaseClient', () => ({
  supabase: mockSupabase,
}));

// Mock React Router, but preserve key components for testing
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '', state: null }),
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
  // Nuclear cleanup
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.restoreAllMocks();

  // Clean up DOM
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  }

  // Clean up window events
  if (typeof window !== 'undefined') {
    // Remove all event listeners
    const events = [
      'beforeunload', 'unload', 'resize', 'scroll', 'click', 'keydown',
      'keyup', 'focus', 'blur', 'load', 'error', 'message'
    ];

    events.forEach(event => {
      const listeners = window[`__${event}Listeners__`] || [];
      listeners.forEach(listener => {
        window.removeEventListener(event, listener);
      });
      window[`__${event}Listeners__`] = [];
    });

    // Clear any custom properties
    Object.keys(window).forEach(key => {
      if (key.startsWith('__') || key.includes('mock') || key.includes('test')) {
        delete window[key];
      }
    });
  }

  // Force another GC
  if (global.gc) {
    global.gc();
  }
});
