//Fixed  SessionSidebar.test.tsx with memory cleanup v2
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';
import type { SessionSidebarProps } from '../SessionSidebar';

// Mock AuthContext instead of just the hook
const mockAuthContextValue = {
  user: null,
  profile: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  loading: false,
};

// Create a mock AuthProvider
const MockAuthProvider: React.FC<{ children: React.ReactNode; value?: any }> = ({
  children,
  value = mockAuthContextValue
}) => {
  // Mock the AuthContext.Provider
  return React.createElement('div', { 'data-testid': 'mock-auth-provider' }, children);
};

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/useAuth', () => ({
  useAuth: () => mockAuthContextValue,
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
  actualMode: null,
  saveSession: vi.fn().mockResolvedValue({ session: {}, usageExceeded: false }),
  elapsedTime: 0,
  modelLoadingProgress: null,
};

describe('SessionSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Reset the mock auth context to default values
    mockAuthContextValue.user = null;
    mockAuthContextValue.profile = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  });

  describe('for a Free user', () => {
    beforeEach(() => {
      mockAuthContextValue.user = { id: 'free-user' };
      mockAuthContextValue.profile = { subscription_status: 'free' };
    });

    it('renders with "Native" as the default mode and disables advanced modes', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      expect(screen.getByRole('button', { name: 'Cloud AI' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'On-Device' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Native' })).toBeEnabled();
    });

    it('calls startListening with native mode', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenCalledWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true,
      });
    });
  });

  describe('for a Pro user', () => {
    beforeEach(() => {
      mockAuthContextValue.user = { id: 'pro-user' };
      mockAuthContextValue.profile = { subscription_status: 'pro' };
    });

    it('renders with all modes enabled and "Cloud AI" as default', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      expect(screen.getByRole('button', { name: 'Cloud AI' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'On-Device' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Native' })).toBeEnabled();
    });

    it('calls startListening with cloud mode by default', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenCalledWith({
        forceCloud: true,
        forceOnDevice: false,
        forceNative: false,
      });
    });

    it('can switch to and start in on-device mode', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'On-Device' }));
      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenCalledWith({
        forceCloud: false,
        forceOnDevice: true,
        forceNative: false,
      });
    });
  });

  describe('for a Dev user', () => {
    beforeEach(() => {
      // Dev user might be on a free tier, but the env var should override
      mockAuthContextValue.user = { id: 'dev-user' };
      mockAuthContextValue.profile = { subscription_status: 'free' };
      vi.stubEnv('VITE_DEV_USER', 'true');
    });

    it('renders with all modes enabled, even on a free subscription', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      expect(screen.getByRole('button', { name: 'Cloud AI' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'On-Device' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Native' })).toBeEnabled();
    });

    it('can switch to and start in any mode', () => {
      render(
        <MockAuthProvider>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      // Starts in cloud by default
      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: true,
        forceOnDevice: false,
        forceNative: false
      });

      // Switch to on-device
      fireEvent.click(screen.getByRole('button', { name: 'On-Device' }));
      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: true,
        forceNative: false
      });

      // Switch to native
      fireEvent.click(screen.getByRole('button', { name: 'Native' }));
      fireEvent.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true
      });
    });
  });
});
