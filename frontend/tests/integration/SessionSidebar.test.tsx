import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionSidebar } from '@/components/session/SessionSidebar';
import type { SessionSidebarProps } from '@/components/session/SessionSidebar';
import { AuthContextType } from '@/contexts/AuthProvider';
import { AuthContext } from '@/contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { makeQuerySuccess } from '../test-utils/queryMocks';

// Mock AuthContext instead of just the hook
const mockAuthContextValue: Partial<AuthContextType> = {
  user: null,
  signOut: vi.fn(),
  loading: false,
  session: null,
};

// Create a mock AuthProvider
const MockAuthProvider: React.FC<{ children: React.ReactNode; value: Partial<AuthContextType> }> = ({
  children,
  value,
}) => {
  return <AuthContext.Provider value={value as AuthContextType}>{children}</AuthContext.Provider>;
};

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/contexts/AuthProvider', async () => {
  const actual = await vi.importActual('@/contexts/AuthProvider');
  return {
    ...(actual as object),
    useAuthProvider: () => mockAuthContextValue,
  };
});

vi.mock('@/hooks/useUserProfile');

vi.mock('@/lib/logger', () => ({
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
      vi.mocked(useUserProfile).mockReturnValue(makeQuerySuccess({
        id: 'free-user',
        subscription_status: 'free',
        usage_seconds: 0,
        usage_reset_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      }));
    });

    it('renders with "Native" as the default mode and disables advanced modes', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Native' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud' })).toHaveAttribute('aria-disabled', 'true');
      expect(await screen.findByRole('menuitemradio', { name: 'Private' })).toHaveAttribute('aria-disabled', 'true');
      expect(await screen.findByRole('menuitemradio', { name: 'Native' })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('calls startListening with native mode', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenCalledExactlyOnceWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true,
      });
    });
  });

  describe('for a Pro user', () => {
    beforeEach(() => {
      mockAuthContextValue.user = { id: 'pro-user', app_metadata: {}, user_metadata: {}, aud: '', created_at: '' };
      vi.mocked(useUserProfile).mockReturnValue(makeQuerySuccess({
        id: 'pro-user',
        subscription_status: 'pro',
        usage_seconds: 0,
        usage_reset_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      }));
    });

    it('renders with all modes enabled and "Cloud" as default', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Cloud' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'Private' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'Native' })).toBeEnabled();
    });

    it('calls startListening with cloud mode by default', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenCalledExactlyOnceWith({
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

      await user.click(screen.getByRole('button', { name: 'Cloud' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'Private' }));
      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenCalledExactlyOnceWith({
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
      vi.mocked(useUserProfile).mockReturnValue(makeQuerySuccess({
        id: 'dev-user',
        subscription_status: 'free',
        usage_seconds: 0,
        usage_reset_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      }));
      vi.stubEnv('VITE_DEV_USER', 'true');
    });

    it('renders with all modes enabled, even on a free subscription', async () => {
      const user = userEvent.setup();
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Cloud' }));
      expect(await screen.findByRole('menuitemradio', { name: 'Cloud' })).toBeEnabled();
      expect(await screen.findByRole('menuitemradio', { name: 'Private' })).toBeEnabled();
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
      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: true,
        forceOnDevice: false,
        forceNative: false
      });

      // Switch to Private
      await user.click(screen.getByRole('button', { name: 'Cloud' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'Private' }));
      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: true,
        forceNative: false
      });

      // Switch to native
      await user.click(screen.getByRole('button', { name: 'Private' }));
      await user.click(await screen.findByRole('menuitemradio', { name: 'Native' }));
      await user.click(screen.getByText('Start Speaking'));
      expect(mockStartListening).toHaveBeenLastCalledWith({
        forceCloud: false,
        forceOnDevice: false,
        forceNative: true
      });
    });
  });


  describe('Session Flow', () => {
    it('calls stopListening and shows the end session dialog when stopping a session', async () => {
      const user = userEvent.setup();
      const props = { ...defaultProps, isListening: true, startTime: Date.now() - 2000 };
      render(
        <MockAuthProvider value={mockAuthContextValue}>
          <SessionSidebar {...props} />
        </MockAuthProvider>
      );

      await user.click(screen.getByTestId('session-start-stop-button'));
      expect(mockStopListening).toHaveBeenCalledOnce();
      expect(await screen.findByText('Session Ended')).toBeInTheDocument();
    });
  });
});
