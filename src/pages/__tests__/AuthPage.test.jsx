// src/pages/__tests__/AuthPage.test.jsx - More Robust Version
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../../test/test-utils';
import userEvent from '@testing-library/user-event';
import AuthPage from '../AuthPage';

// Comprehensive mock setup
var mockSupabase = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn()
  },
  from: vi.fn()
};

// Mock supabase completely
vi.mock('@/lib/supabaseClient', () => ({
  supabase: mockSupabase
}));

// Mock environment
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: false,
    VITE_DEV_PREMIUM_ACCESS: 'false'
  }
});

describe('AuthPage', () => {
  let user;

  beforeEach(() => {
    vi.useFakeTimers();
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Reset all mocks
    vi.clearAllMocks();

    // Setup default successful auth responses
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: null
    });
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null
    });
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: null
    });
    mockSupabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null
    });
    mockSupabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } }
    });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      })
    });

    // Clear any existing DOM
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper function with proper auth context
  const renderAuthPage = (authOverrides = {}) => {
    const authMock = {
      session: null,
      user: null,
      profile: null,
      loading: false,
      signOut: vi.fn().mockResolvedValue(undefined),
      ...authOverrides
    };

    return render(<AuthPage />, {
      authMock,
      route: '/auth'
    });
  };

  it('renders without crashing when no session exists', async () => {
    console.log('🧪 Test: renders without crashing');

    renderAuthPage();

    // Wait for component to render - increase timeout for safety
    await waitFor(() => {
      const form = screen.queryByTestId('auth-form');
      expect(form).toBeInTheDocument();
    }, { timeout: 10000 });

    console.log('✅ Test passed: form rendered');
  });

  it('shows sign in form elements', async () => {
    console.log('🧪 Test: shows sign in form elements');

    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    }, { timeout: 10000 });

    // Check all expected elements exist
    expect(screen.getByTestId('email-input')).toBeInTheDocument();
    expect(screen.getByTestId('password-input')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-submit')).toBeInTheDocument();

    console.log('✅ Test passed: all form elements present');
  });

  it('does not render form when session exists (redirect case)', () => {
    console.log('🧪 Test: redirect when session exists');

    const mockSession = {
      user: { id: '123', email: 'test@example.com' },
      access_token: 'mock-token'
    };

    renderAuthPage({
      session: mockSession,
      user: mockSession.user,
      profile: { id: '123', subscription_status: 'free' }
    });

    // When session exists, AuthPage should render Navigate instead of form
    expect(screen.queryByTestId('auth-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-form')).not.toBeInTheDocument();

    console.log('✅ Test passed: no form when session exists');
  });

  it('handles basic interactions without hanging', async () => {
    console.log('🧪 Test: handles basic interactions');

    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    }, { timeout: 10000 });

    // Try basic interaction - mode toggle
    const toggleButton = screen.getByTestId('mode-toggle');
    expect(toggleButton).toBeInTheDocument();

    // Click should work without hanging
    await user.click(toggleButton);
    vi.runAllTimers();

    // Wait for state change with timeout
    await waitFor(() => {
      expect(screen.queryByTestId('sign-up-submit')).toBeInTheDocument();
    }, { timeout: 5000 });

    console.log('✅ Test passed: basic interaction works');
  });

  it('can handle form submission attempt', async () => {
    console.log('🧪 Test: form submission');

    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    }, { timeout: 10000 });

    // Fill out form quickly
    const emailInput = screen.getByTestId('email-input');
    const passwordInput = screen.getByTestId('password-input');
    const submitButton = screen.getByTestId('sign-in-submit');

    await user.type(emailInput, 'test@example.com');
    vi.runAllTimers();

    await user.type(passwordInput, 'password123');
    vi.runAllTimers();

    // Submit form
    await user.click(submitButton);
    vi.runAllTimers();

    // Verify supabase was called (basic integration check)
    await waitFor(() => {
      expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    }, { timeout: 5000 });

    console.log('✅ Test passed: form submission works');
  });
});
