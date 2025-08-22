// src/setupTests.js
import { jest } from '@jest/globals';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for TextEncoder and TextDecoder
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Global test setup
global.jest = jest;

// Mock browser APIs
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock SpeechRecognition
global.SpeechRecognition = class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = 'en-US';
  }
  start() {}
  stop() {}
  abort() {}
};

global.webkitSpeechRecognition = global.SpeechRecognition;

// import.meta.env is now handled by a Babel plugin
