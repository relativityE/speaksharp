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

// Stateful SpeechRecognition Mock provided by user
class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.lang = 'en-US';
    this.interimResults = false;
    this.maxAlternatives = 1;

    // Event handlers (assignable)
    this.onstart = null;
    this.onend = null;
    this.onresult = null;
    this.onerror = null;

    // Internal state
    this._listening = false;
    this._timeoutId = null;
  }

  start() {
    if (this._listening) {
      // Already listening — ignore duplicate start calls
      return;
    }
    this._listening = true;

    // Simulate async start
    setTimeout(() => {
      this.onstart?.();
      // Optional: simulate recognition result
      this._simulateResult();
    }, 10);

    // Simulate speech end after some delay
    this._timeoutId = setTimeout(() => {
      if (!this._listening) return;
      this._listening = false;
      this.onend?.();
    }, 200); // adjust as needed
  }

  stop() {
    if (!this._listening) return;
    this._listening = false;
    clearTimeout(this._timeoutId);
    setTimeout(() => {
      this.onend?.();
    }, 10);
  }

  abort() {
    this.stop();
  }

  _simulateResult() {
    setTimeout(() => {
      if (!this._listening) return;
      const fakeEvent = {
        results: [
          [
            {
              transcript: 'test phrase',
              confidence: 0.9,
            },
          ],
        ],
        resultIndex: 0,
      };
      if (fakeEvent.results[0]) {
        fakeEvent.results[0].isFinal = true;
      }
      this.onresult?.(fakeEvent);
    }, 50);
  }
}

// Attach mock globally
global.SpeechRecognition = MockSpeechRecognition;
global.webkitSpeechRecognition = MockSpeechRecognition;


afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  // Force garbage collection in tests
  if (global.gc) {
    global.gc()
  }
})
