import { afterEach } from '@jest/globals';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for TextEncoder and TextDecoder
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock import.meta.env for Jest
Object.defineProperty(global, 'import.meta', {
  value: {
    env: {
      VITE_STRIPE_PRICE_ID: 'mock_price_id',
      VITE_SUPABASE_URL: 'mock_url',
      VITE_SUPABASE_ANON_KEY: 'mock_key',
      // Add any other env variables that are used in the code
    },
  },
  writable: true,
});


// React Testing Library's cleanup function runs after each test
afterEach(() => {
  cleanup();
});

jest.mock('./lib/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockResolvedValue({ data: [], error: null }),
      insert: jest.fn().mockResolvedValue({ data: [{}], error: null }),
      delete: jest.fn().mockResolvedValue({ data: {}, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: jest.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
    functions: {
        invoke: jest.fn().mockResolvedValue({ data: {}, error: null }),
    }
  },
}));
