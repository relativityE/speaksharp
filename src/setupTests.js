import '@testing-library/jest-dom'

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

// Mock SpeechRecognition API
global.SpeechRecognition = class SpeechRecognition {
  constructor() {
    this.continuous = false
    this.interimResults = false
    this.lang = 'en-US'
    this.onresult = null
    this.onerror = null
    this.onstart = null
    this.onend = null
  }
  
  start() {
    if (this.onstart) this.onstart()
  }
  
  stop() {
    if (this.onend) this.onend()
  }
  
  abort() {
    if (this.onend) this.onend()
  }
}

global.webkitSpeechRecognition = global.SpeechRecognition

// Mock getUserMedia
global.navigator.mediaDevices = {
  getUserMedia: vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }]
  })
}


import '@testing-library/dom'


