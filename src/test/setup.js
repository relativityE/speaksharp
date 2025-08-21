// src/test/setup.js
import { beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom'

// Global cleanup to prevent memory leaks
beforeEach(() => {
  // Clear all timers
  vi.clearAllTimers()
  // Clear all mocks
  vi.clearAllMocks()
})

afterEach(() => {
  // Force cleanup of any pending operations
  vi.clearAllTimers()
  vi.restoreAllMocks()
  if (global.cleanupTestMocks) {
    global.cleanupTestMocks();
  }
})

// Enhanced MediaRecorder mock with proper lifecycle
class MockMediaRecorder {
  constructor(stream, options = {}) {
    this.stream = stream
    this.options = options
    this.state = 'inactive'
    this.ondataavailable = null
    this.onstop = null
    this.onstart = null
    this.onerror = null
    this.onpause = null
    this.onresume = null
    this.chunks = []
  }

  start(timeslice = 1000) {
    if (this.state !== 'inactive') {
      throw new Error('MediaRecorder is not in inactive state')
    }

    this.state = 'recording'

    // Immediately call onstart
    if (this.onstart) {
      setTimeout(() => this.onstart(), 0)
    }

    // Simulate data available events
    this.dataInterval = setInterval(() => {
      if (this.state === 'recording' && this.ondataavailable) {
        const mockBlob = new Blob(['mock audio data'], { type: 'audio/webm' })
        this.chunks.push(mockBlob)
        this.ondataavailable({ data: mockBlob })
      }
    }, timeslice)
  }

  stop() {
    if (this.state === 'inactive') {
      return
    }

    this.state = 'inactive'

    // Clear the data interval
    if (this.dataInterval) {
      clearInterval(this.dataInterval)
      this.dataInterval = null
    }

    // Call onstop with final blob
    if (this.onstop) {
      setTimeout(() => {
        new Blob(this.chunks, { type: 'audio/webm' })
        this.onstop()
      }, 0)
    }
  }

  pause() {
    if (this.state === 'recording') {
      this.state = 'paused'
      if (this.onpause) {
        setTimeout(() => this.onpause(), 0)
      }
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'recording'
      if (this.onresume) {
        setTimeout(() => this.onresume(), 0)
      }
    }
  }

  requestData() {
    if (this.state === 'recording' && this.ondataavailable) {
      const mockBlob = new Blob(['mock audio data'], { type: 'audio/webm' })
      this.ondataavailable({ data: mockBlob })
    }
  }

  // Cleanup method for tests
  cleanup() {
    if (this.dataInterval) {
      clearInterval(this.dataInterval)
      this.dataInterval = null
    }
    this.state = 'inactive'
    this.chunks = []
  }
}

// Mock MediaStream
class MockMediaStream {
  constructor() {
    this.active = true
    this.id = Math.random().toString(36).substring(7)
    this._tracks = [
      {
        kind: 'audio',
        enabled: true,
        readyState: 'live',
        stop: vi.fn(() => {
          this.active = false
        })
      }
    ]
  }

  getTracks() {
    return [...this._tracks]
  }

  getAudioTracks() {
    return this._tracks.filter(track => track.kind === 'audio')
  }

  getVideoTracks() {
    return this._tracks.filter(track => track.kind === 'video')
  }
}

// Enhanced navigator.mediaDevices mock
const mockMediaDevices = {
  getUserMedia: vi.fn().mockImplementation(() => {
    return Promise.resolve(new MockMediaStream())
  }),

  enumerateDevices: vi.fn().mockResolvedValue([
    {
      deviceId: 'default',
      kind: 'audioinput',
      label: 'Default - Built-in Microphone',
      groupId: 'default'
    }
  ])
}

// Apply mocks
global.MediaRecorder = MockMediaRecorder
global.navigator = {
  ...global.navigator,
  mediaDevices: mockMediaDevices,
  userAgent: 'Mozilla/5.0 (Test Environment)'
}

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock Web Speech API
global.webkitSpeechRecognition = vi.fn().mockImplementation(() => ({
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
}))

global.SpeechRecognition = global.webkitSpeechRecognition

// Mock Audio Context
global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn(),
  createAnalyser: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  state: 'running'
}))

global.webkitAudioContext = global.AudioContext

// Mock Blob and File APIs
global.Blob = class MockBlob {
  constructor(parts, options = {}) {
    this.size = parts.reduce((acc, part) => acc + (part.length || 0), 0)
    this.type = options.type || ''
  }

  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(this.size))
  }

  text() {
    return Promise.resolve('mock blob text')
  }
}

// Cleanup function for test teardown
global.cleanupTestMocks = () => {
  // Clear any active MediaRecorder instances
  if (global.MediaRecorder.prototype.cleanup) {
    global.MediaRecorder.prototype.cleanup()
  }
}

// Mock Supabase client to prevent multiple GoTrue instances during tests
vi.mock('sharp', () => {
  return {
    default: vi.fn(() => ({
      resize: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from([])),
      toFile: vi.fn().mockResolvedValue({}),
      jpeg: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: [{}], error: null }),
      delete: vi.fn().mockResolvedValue({ data: {}, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
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
