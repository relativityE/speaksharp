import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';
import type { SessionSidebarProps } from '../SessionSidebar';
import { AuthContextType } from '../../../contexts/AuthContext';

import { UserProfile } from '../../../types/user';
import { User } from '@supabase/supabase-js';

// Mock AuthContext instead of just the hook
const mockAuthContextValue: AuthContextType = {
  user: null,
  profile: null,
  signOut: vi.fn(),
  loading: false,
  session: null,
  is_anonymous: false,
};

import { AuthContext } from '../../../contexts/AuthContext';

// Create a mock AuthProvider
const MockAuthProvider: React.FC<{ children: React.ReactNode; value: AuthContextType }> = ({
  children,
  value,
}) => {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
  startTime: null,
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
      mockAuthContextValue.user = { id: 'free-user', app_metadata: {}, user_metadata: {}, aud: '', created_at: '' };
      mockAuthContextValue.profile = { id: 'free-user', subscription_status: 'free' };
    });

    it('renders with "Native" as the default mode and disables advanced modes', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Native' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud AI' })).toHaveAttribute('aria-disabled', 'true');
      expect(await screen.findByRole('menuitemradio', { name: 'On-Device' })).toHaveAttribute('aria-disabled', 'true');
      expect(await screen.findByRole('menuitemradio', { name: 'Native' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('calls startListening with native mode', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenCalledWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true,
      });
    });
  });

  describe('for a Pro user', () => {
    beforeEach(() => {
      mockAuthContextValue.user = { id: 'pro-user', app_metadata: {}, user_metadata: {}, aud: '', created_at: '' };
      mockAuthContextValue.profile = { id: 'pro-user', subscription_status: 'pro' };
    });

    it('renders with all modes enabled and "Cloud AI" as default', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Cloud AI' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud AI' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'On-Device' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'Native' })).toBeEnabled();
    });

    it('calls startListening with cloud mode by default', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenCalledWith({
        forceCloud: true,
        forceOnDevice: false,
        forceNative: false,
      });
    });

    it('can switch to and start in on-device mode', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Cloud AI' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'On-Device' }));
      await user.click(screen.getByText('Start Session'));
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
      mockAuthContextValue.user = { id: 'dev-user', app_metadata: {}, user_metadata: {}, aud: '', created_at: '' };
      mockAuthContextValue.profile = { id: 'dev-user', subscription_status: 'free' };
      vi.stubEnv('VITE_DEV_USER', 'true');
    });

    it('renders with all modes enabled, even on a free subscription', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Cloud AI' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud AI' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'On-Device' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'Native' })).toBeEnabled();
    });

    it('can switch to and start in any mode', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      // Starts in cloud by default
      await user.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: true,
        forceOnDevice: false,
        forceNative: false
      });

      // Switch to on-device
      await user.click(screen.getByRole('button', { name: 'Cloud AI' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'On-Device' }));
      await user.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: true,
        forceNative: false
      });

      // Switch to native
      await user.click(screen.getByRole('button', { name: 'On-Device' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'Native' }));
      await user.click(screen.getByText('Start Session'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true
      });
    });
  });
});
