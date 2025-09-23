import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';
import type { SessionSidebarProps } from '../SessionSidebar';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    profile: { subscription_status: 'free' },
  }),
}));

vi.mock('../../lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const mockStartListening = vi.fn();
const mockStopListening = vi.fn().mockResolvedValue({ transcript: 'test' });

const defaultProps: SessionSidebarProps = {
  isListening: false,
  isReady: true,
  error: null,
  startListening: mockStartListening,
  stopListening: mockStopListening,
  reset: vi.fn(),
  actualMode: 'cloud',
  saveSession: vi.fn().mockResolvedValue({ session: {}, usageExceeded: false }),
  elapsedTime: 0,
  modelLoadingProgress: null,
};

describe('SessionSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly and calls startListening with "Cloud AI" as the default selected mode', () => {
    render(<SessionSidebar {...defaultProps} />);
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();

    const startButton = screen.getByText('Start Session');
    fireEvent.click(startButton);
    expect(mockStartListening).toHaveBeenCalledWith({
      forceCloud: true,
      forceOnDevice: false,
      forceNative: false,
    });
  });

  it('calls startListening with on-device mode when "On-Device" button is clicked', () => {
    render(<SessionSidebar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'On-Device' }));

    const startButton = screen.getByText('Start Session');
    fireEvent.click(startButton);

    expect(mockStartListening).toHaveBeenCalledWith({
      forceCloud: false,
      forceOnDevice: true,
      forceNative: false,
    });
  });

  it('calls startListening with native mode when "Native" button is clicked', () => {
    render(<SessionSidebar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Native' }));

    const startButton = screen.getByText('Start Session');
    fireEvent.click(startButton);

    expect(mockStartListening).toHaveBeenCalledWith({
      forceCloud: false,
      forceOnDevice: false,
      forceNative: true,
    });
  });

  it('shows "Stop Session" button and calls stopListening when listening', () => {
    render(<SessionSidebar {...defaultProps} isListening={true} />);
    const stopButton = screen.getByText('Stop Session');
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);
    expect(mockStopListening).toHaveBeenCalled();
  });

  it('disables the mode selection buttons when a session is active', () => {
    render(<SessionSidebar {...defaultProps} isListening={true} />);
    expect(screen.getByRole('button', { name: 'Cloud AI' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'On-Device' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Native' })).toBeDisabled();
  });

  it('disables the mode selection buttons when the model is loading', () => {
    render(
      <SessionSidebar
        {...defaultProps}
        modelLoadingProgress={{ status: 'download', file: 'model.bin', loaded: 50, total: 100 }}
      />
    );
    expect(screen.getByRole('button', { name: 'Cloud AI' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'On-Device' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Native' })).toBeDisabled();
  });
});
