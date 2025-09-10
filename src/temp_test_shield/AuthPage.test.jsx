// src/pages/__tests__/AuthPage.test.jsx
console.log('[FILE LOADED] AuthPage.test.jsx starting to load');
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../test/test-utils';
console.log('[IMPORTS COMPLETE] All imports loaded successfully');
import userEvent from '@testing-library/user-event';
import AuthPage from '../AuthPage';

// Mock supabase at the module level with comprehensive mocking
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } }
      }),
      signOut: vi.fn().mockResolvedValue({ error: null })
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      })
    })
  }
}));

// Mock environment variables
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: false,
    VITE_DEV_PREMIUM_ACCESS: 'false'
  },
  writable: true
});

const renderAuthPage = (options = {}) => {
  // Provide a complete auth mock that matches the real AuthContext shape
  const authMock = {
    session: null,
    user: null,
    profile: null,
    loading: false, // Important: set to false so component renders immediately
    signOut: vi.fn().mockResolvedValue(undefined),
    ...options.authMock
  };

  return render(<AuthPage />, {
    ...options,
    authMock,
    route: '/auth'
  });
};

describe('AuthPage', () => {
  console.log('[DESCRIBE START] AuthPage');
  let user;

  beforeEach(() => {
    console.log('[TEST START] beforeEach running');
    vi.useFakeTimers();
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    document.body.innerHTML = '';

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.log('[TEST END] afterEach running');
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders sign in form by default', async () => {
    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    });

    expect(screen.getByTestId('email-input')).toBeInTheDocument();
    expect(screen.getByTestId('password-input')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-submit')).toBeInTheDocument();
  });

  it('switches to sign up mode when toggle is clicked', async () => {
    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    });

    const toggleButton = screen.getByTestId('mode-toggle');
    await user.click(toggleButton);

    // Advance timers to handle any state updates
    vi.runAllTimers();

    await waitFor(() => {
      expect(screen.getByTestId('sign-up-submit')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('sign-in-submit')).not.toBeInTheDocument();
  });

  it('shows forgot password form when link is clicked', async () => {
    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    });

    const forgotPasswordLink = screen.getByTestId('forgot-password-button');
    await user.click(forgotPasswordLink);

    // Advance timers to handle any state updates
    vi.runAllTimers();

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-form')).toBeInTheDocument();
    });
  });

  it('handles form submission without errors', async () => {
    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    });

    // Fill out form
    const emailInput = screen.getByTestId('email-input');
    const passwordInput = screen.getByTestId('password-input');

    await user.type(emailInput, 'test@example.com');
    vi.runAllTimers();

    await user.type(passwordInput, 'password123');
    vi.runAllTimers();

    // Submit form
    const submitButton = screen.getByTestId('sign-in-submit');
    await user.click(submitButton);

    // Advance timers to handle the async form submission
    vi.runAllTimers();

    // Wait for form submission to complete
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    // Verify the supabase method was called
    const { supabase } = await import('@/lib/supabaseClient');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123'
    });
  });

  it('redirects when user has active session', async () => {
    const mockSession = {
      user: { id: '123', email: 'test@example.com' },
      access_token: 'mock-token'
    };

    renderAuthPage({
      authMock: {
        session: mockSession,
        user: mockSession.user,
        profile: { id: '123', subscription_status: 'free' },
        loading: false,
        signOut: vi.fn().mockResolvedValue(undefined)
      }
    });

    // When session exists, AuthPage renders Navigate component instead of form
    expect(screen.queryByTestId('auth-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-form')).not.toBeInTheDocument();
  });

  it('handles sign up mode correctly', async () => {
    renderAuthPage();

    await waitFor(() => {
      expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    });

    // Switch to sign up mode
    const toggleButton = screen.getByTestId('mode-toggle');
    await user.click(toggleButton);
    vi.runAllTimers();

    await waitFor(() => {
      expect(screen.getByTestId('sign-up-submit')).toBeInTheDocument();
    });

    // Fill and submit sign up form
    await user.type(screen.getByTestId('email-input'), 'new@example.com');
    vi.runAllTimers();

    await user.type(screen.getByTestId('password-input'), 'newpassword123');
    vi.runAllTimers();

    const submitButton = screen.getByTestId('sign-up-submit');
    await user.click(submitButton);
    vi.runAllTimers();

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    // Verify the correct supabase method was called
    const { supabase } = await import('@/lib/supabaseClient');
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'newpassword123'
    });
  });
});
