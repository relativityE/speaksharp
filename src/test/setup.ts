// [JULES] This file is used to set up the test environment.
// The jest-dom import was removed as the package is no longer a dependency.

// Polyfills for browser-like APIs you may use
globalThis.TextEncoder = require('util').TextEncoder;
globalThis.TextDecoder = require('util').TextDecoder as any;

// Mocking Vite env vars
process.env.VITE_SUPABASE_URL = 'http://localhost:54321';
process.env.VITE_SUPABASE_KEY = 'test-key';
