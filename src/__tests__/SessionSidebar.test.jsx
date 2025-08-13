// src/__tests__/SessionSidebar.test.jsx
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SessionSidebar } from '../components/session/SessionSidebar';
import { useAuth } from '../contexts/AuthContext';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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

  it('transitions UI from idle -> initializing -> recording -> idle', async () => {
    // We need to render the component with a real hook to test the integration
    // We render SessionPage because it wires up the hook and the sidebar
    const { SessionPage } = await import('../pages/SessionPage');
    render(<SessionPage />);

    // State 1: Idle, button shows "Start Recording"
    const startButton = screen.getByRole('button', { name: /Start Recording/i });
    expect(startButton).toBeInTheDocument();

    // Action: Click the start button
    act(() => {
      fireEvent.click(startButton);
    });

    // State 2: Initializing, button shows "Starting..."
    // The component's internal `isLoading` state is true
    expect(screen.getByText(/Starting.../i)).toBeInTheDocument();
    expect(screen.getByText(/INITIALIZING.../i)).toBeInTheDocument();

    // Action: Advance timers to allow mock SpeechRecognition onstart to fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    // State 3: Recording, button shows "End Session"
    expect(screen.getByText(/● RECORDING/i)).toBeInTheDocument();
    const endButton = screen.getByRole('button', { name: /End Session/i });
    expect(endButton).toBeInTheDocument();

    // Action: Click the end button, which should call stopListening()
    act(() => {
        fireEvent.click(endButton);
    });

    // State 4: Idle again
    expect(screen.getByRole('button', { name: /Start Recording/i })).toBeInTheDocument();
  });
});
