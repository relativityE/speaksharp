import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' }, profile: { subscription_status: 'free' } }),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  useStripe: () => ({ redirectToCheckout: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('lucide-react', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        Cloud: () => <div data-testid="cloud-icon" />,
        Computer: () => <div data-testid="computer-icon" />,
    };
});

const defaultProps = {
  isListening: false,
  isReady: false,
  error: null,
  startListening: vi.fn(),
  stopListening: vi.fn().mockResolvedValue({ transcript: 'test transcript' }),
  reset: vi.fn(),
  actualMode: 'native',
  saveSession: vi.fn().mockResolvedValue({ id: 'new-session-id' }),
  elapsedTime: 0,
  modelLoadingProgress: null,
};

describe('SessionSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in its initial idle state', () => {
    render(<SessionSidebar {...defaultProps} />);
    expect(screen.getByText('Start Session')).toBeInTheDocument();
    // Use regex to find "Ready" within the status title
    expect(screen.getByText(/Ready/i)).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('calls startListening when the "Start Session" button is clicked', async () => {
    render(<SessionSidebar {...defaultProps} />);
    const startButton = screen.getByText('Start Session');
    fireEvent.click(startButton);
    await waitFor(() => {
      expect(defaultProps.startListening).toHaveBeenCalled();
    });
  });

  it('renders in the listening state', () => {
    render(<SessionSidebar {...defaultProps} isListening={true} isReady={true} elapsedTime={30} />);
    expect(screen.getByText('Stop Session')).toBeInTheDocument();
    expect(screen.getByText('Session Active')).toBeInTheDocument();
    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  describe('ModeIndicator', () => {
    it('shows Cloud AI mode correctly', () => {
      render(<SessionSidebar {...defaultProps} actualMode="cloud" />);
      expect(screen.getByText('Cloud AI')).toBeInTheDocument();
      expect(screen.getByTestId('cloud-icon')).toBeInTheDocument();
    });

    it('shows Browser mode correctly', () => {
      render(<SessionSidebar {...defaultProps} actualMode="native" />);
      expect(screen.getByText('Browser')).toBeInTheDocument();
      expect(screen.getByTestId('computer-icon')).toBeInTheDocument();
    });

    it('does not render the indicator if mode is not set', () => {
      render(<SessionSidebar {...defaultProps} actualMode={null} />);
      expect(screen.queryByText('Cloud AI')).not.toBeInTheDocument();
      expect(screen.queryByText('Browser')).not.toBeInTheDocument();
    });
  });

  it('calls stopListening when the "Stop Session" button is clicked', async () => {
    render(<SessionSidebar {...defaultProps} isListening={true} isReady={true} />);
    const stopButton = screen.getByText('Stop Session');
    fireEvent.click(stopButton);
    await waitFor(() => {
      expect(defaultProps.stopListening).toHaveBeenCalled();
    });
  });

  it.skip('shows the end session dialog after stopping', async () => {
    const user = userEvent.setup();
    render(<SessionSidebar {...defaultProps} isListening={true} isReady={true} />);
    const stopButton = screen.getByText('Stop Session');

    await act(async () => {
      await user.click(stopButton);
    });

    expect(await screen.findByText('Session Ended')).toBeInTheDocument();
    expect(screen.getByText('Go to Analytics')).toBeInTheDocument();
  });

  it.skip('saves the session with duration and navigates to analytics', async () => {
    const user = userEvent.setup();
    const propsWithTime = { ...defaultProps, elapsedTime: 123 };
    render(<SessionSidebar {...propsWithTime} isListening={true} isReady={true} />);
    const stopButton = screen.getByText('Stop Session');

    await act(async () => {
      await user.click(stopButton);
    });

    const goToAnalyticsButton = await screen.findByText('Go to Analytics');

    await act(async () => {
      await user.click(goToAnalyticsButton);
    });

    await waitFor(() => {
      expect(propsWithTime.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: 'test transcript',
          duration: 123,
        })
      );
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/analytics/new-session-id');
    });
  });
});
