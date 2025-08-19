// src/__tests__/SessionSidebar.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { useAuth } from '../contexts/AuthContext';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

// Mock dependencies
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: vi.fn(),
    }),
}));

const stripePromise = loadStripe('pk_test_123'); // Mock publishable key

describe('SessionSidebar component', () => {
  const mockUseAuth = useAuth;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUseAuth.mockReturnValue({
      user: { id: 'test-user' },
      profile: { subscription_status: 'free', usage_seconds: 0 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('transitions UI from idle -> initializing -> recording -> idle', () => {
    const props = {
      isListening: false,
      transcript: '',
      fillerData: {},
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      reset: vi.fn(),
      customWords: [],
      setCustomWords: vi.fn(),
      saveSession: vi.fn(),
    };

    const { rerender } = render(
      <Elements stripe={stripePromise}>
        <SessionSidebar {...props} />
      </Elements>
    );

    // State 1: Idle
    expect(screen.getByRole('button', { name: /Start Recording/i })).toBeInTheDocument();

    // State 2: Initializing
    rerender(
      <Elements stripe={stripePromise}>
        <SessionSidebar {...props} isListening={true} />
      </Elements>
    );

    // State 3: Recording
    rerender(
      <Elements stripe={stripePromise}>
        <SessionSidebar {...props} isListening={true} />
      </Elements>
    );
    expect(screen.getByText(/● RECORDING/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /End Session/i })).toBeInTheDocument();

    // State 4: Idle again
    rerender(
      <Elements stripe={stripePromise}>
        <SessionSidebar {...props} isListening={false} />
      </Elements>
    );
    expect(screen.getByRole('button', { name: /Start Recording/i })).toBeInTheDocument();
  });
});
