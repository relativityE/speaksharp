import '@testing-library/jest-dom';
import '@testing-library/dom';
import { vi, afterEach } from 'vitest';

// Mock Web Audio API
global.MediaRecorder = class MediaRecorder {
  constructor() {
    this.state = 'inactive'
    this.ondataavailable = null
    this.onstop = null
    this.onerror = null
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (this.onstop) this.onstop()
  }

  static isTypeSupported() {
    return true
  }
}

// Mock getUserMedia
if (global.navigator === undefined) {
  global.navigator = {};
}
global.navigator.mediaDevices = {
  getUserMedia: vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }]
  })
}

// Mock SpeechRecognition globally
const mockSpeechRecognition = vi.fn().mockImplementation(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  continuous: true,
  interimResults: true,
}))

global.SpeechRecognition = mockSpeechRecognition
global.webkitSpeechRecognition = mockSpeechRecognition

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  // Force garbage collection in tests
  if (global.gc) {
    global.gc()
  }
})
