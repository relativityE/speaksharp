import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionSidebar } from '../SessionSidebar';
import type { SessionSidebarProps } from '../SessionSidebar';
import { AuthContext } from '../../contexts/AuthContext';

// Mock other dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

const baseMockAuthValue = {
  user: null,
  profile: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  loading: false,
  is_anonymous: true,
};

const MockAuthProvider: React.FC<{ children: React.ReactNode; value: any }> = ({
  children,
  value,
}) => {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

describe('SessionSidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  describe('for a Free user', () => {
    const mockValue = {
      ...baseMockAuthValue,
      user: { id: 'free-user' },
      profile: { subscription_status: 'free' },
      is_anonymous: false,
    };

    it('renders with "Native" as the default mode', () => {
      render(
        <MockAuthProvider value={mockValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );
      expect(screen.getByText('Native')).toBeInTheDocument();
    });

    it('calls startListening with native mode', () => {
      render(
        <MockAuthProvider value={mockValue}>
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
    const mockValue = {
      ...baseMockAuthValue,
      user: { id: 'pro-user' },
      profile: { subscription_status: 'pro' },
      is_anonymous: false,
    };

    it('renders with "Cloud AI" as default', () => {
      render(
        <MockAuthProvider value={mockValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );
      expect(screen.getByText('Cloud AI')).toBeInTheDocument();
    });

    it('calls startListening with cloud mode by default', () => {
      render(
        <MockAuthProvider value={mockValue}>
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
  });

  describe('for a Dev user', () => {
    const mockValue = {
      ...baseMockAuthValue,
      user: { id: 'dev-user' },
      profile: { subscription_status: 'free' },
      is_anonymous: false,
    };

    beforeEach(() => {
      vi.stubEnv('VITE_DEV_USER', 'true');
    });

    it('renders with "Cloud AI" as default, even on a free subscription', () => {
      render(
        <MockAuthProvider value={mockValue}>
          <SessionSidebar {...defaultProps} />
        </MockAuthProvider>
      );
      expect(screen.getByText('Cloud AI')).toBeInTheDocument();
    });
  });
});
