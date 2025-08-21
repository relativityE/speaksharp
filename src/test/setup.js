// src/test/setup.js
import { beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock MediaRecorder with robust cleanup to prevent test suite instability.
class MockMediaRecorder {
  static instances = []; // Track all created instances to ensure cleanup.

  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onstart = null;
    this.onerror = null;
    this.onpause = null;
    this.onresume = null;
    this.chunks = [];
    this.dataInterval = null;
    MockMediaRecorder.instances.push(this); // Add instance to tracking array.
  }

  // Static method to clean up all tracked instances. Called after each test.
  static cleanupAll() {
    MockMediaRecorder.instances.forEach(instance => instance.cleanup());
    MockMediaRecorder.instances = [];
  }

  start(timeslice = 1000) {
    if (this.state !== 'inactive') {
      throw new Error('MediaRecorder is not in inactive state');
    }
    this.state = 'recording';
    if (this.onstart) setTimeout(() => this.onstart(), 0);

    this.dataInterval = setInterval(() => {
      if (this.state === 'recording' && this.ondataavailable) {
        const mockBlob = new Blob(['mock audio data'], { type: 'audio/webm' });
        this.chunks.push(mockBlob);
        this.ondataavailable({ data: mockBlob });
      }
    }, timeslice);
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.cleanup(); // Ensure timer is cleared
    if (this.onstop) {
        setTimeout(() => {
            new Blob(this.chunks, { type: 'audio/webm' });
            this.onstop();
        }, 0);
    }
  }

  pause() {
    if (this.state === 'recording') {
      this.state = 'paused';
      if (this.onpause) setTimeout(() => this.onpause(), 0);
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'recording';
      if (this.onresume) setTimeout(() => this.onresume(), 0);
    }
  }

  requestData() {
    if (this.state === 'recording' && this.ondataavailable) {
      const mockBlob = new Blob(['mock audio data'], { type: 'audio/webm' });
      this.ondataavailable({ data: mockBlob });
    }
  }

  // Instance-level cleanup method.
  cleanup() {
    if (this.dataInterval) {
      clearInterval(this.dataInterval);
      this.dataInterval = null;
    }
    this.state = 'inactive';
    this.chunks = [];
  }
}

// Global hooks for test setup and teardown.
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  // This is the critical fix: ensure all MediaRecorder mocks are cleaned up.
  if (global.MediaRecorder.cleanupAll) {
    global.MediaRecorder.cleanupAll();
  }
});


// Mock MediaStream
class MockMediaStream {
  constructor() {
    this.active = true;
    this.id = Math.random().toString(36).substring(7);
    this._tracks = [
      {
        kind: 'audio',
        enabled: true,
        readyState: 'live',
        stop: vi.fn(() => {
          this.active = false;
        })
      }
    ];
  }
  getTracks() { return [...this._tracks]; }
  getAudioTracks() { return this._tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this._tracks.filter(track => track.kind === 'video'); }
}

// Apply mocks to global scope
global.MediaRecorder = MockMediaRecorder;

global.navigator = {
  ...global.navigator,
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
    enumerateDevices: vi.fn().mockResolvedValue([{ deviceId: 'default', kind: 'audioinput', label: 'Default Mic', groupId: 'default' }])
  },
  userAgent: 'Mozilla/5.0 (Test Environment)'
};

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

const mockSpeechRecognition = {
  continuous: false,
  interimResults: false,
  lang: 'en-US',
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onstart: null,
  onend: null,
  onresult: null,
  onerror: null
};
global.webkitSpeechRecognition = vi.fn().mockImplementation(() => mockSpeechRecognition);
global.SpeechRecognition = global.webkitSpeechRecognition;

global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  createAnalyser: vi.fn(() => ({ getByteTimeDomainData: vi.fn() })),
  close: vi.fn().mockResolvedValue(undefined),
  state: 'running'
}));
global.webkitAudioContext = global.AudioContext;

global.Blob = class MockBlob {
  constructor(parts, options = {}) {
    this.size = parts.reduce((acc, part) => acc + (part.length || 0), 0);
    this.type = options.type || '';
  }
  arrayBuffer() { return Promise.resolve(new ArrayBuffer(this.size)); }
  text() { return Promise.resolve('mock blob text'); }
};

// Mock external libraries
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([])),
    jpeg: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockResolvedValue({ data: [{}], error: null }),
    delete: vi.fn().mockResolvedValue({ data: {}, error: null }),
    eq: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
  },
}));
