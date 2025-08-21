// src/__tests__/SessionSidebar.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { useAuth } from '../contexts/AuthContext';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

// Mock dependencies
jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));
jest.mock('../hooks/useSessionManager', () => ({
    useSessionManager: () => ({
        saveSession: jest.fn(),
    }),
}));

const stripePromise = loadStripe('pk_test_123'); // Mock publishable key

describe('SessionSidebar component', () => {
  const mockUseAuth = useAuth;

  beforeEach(() => {
    jest.useFakeTimers();
    mockUseAuth.mockReturnValue({
      user: { id: 'test-user' },
      profile: { subscription_status: 'free', usage_seconds: 0 },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('transitions UI from idle -> initializing -> recording -> idle', () => {
    const props = {
      isListening: false,
      transcript: '',
      fillerData: {},
      error: null,
      isSupported: true,
      startListening: jest.fn(),
      stopListening: jest.fn(),
      reset: jest.fn(),
      customWords: [],
      setCustomWords: jest.fn(),
      saveSession: jest.fn(),
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
