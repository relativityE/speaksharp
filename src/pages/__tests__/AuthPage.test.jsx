import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from '../AuthPage';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';

// Mock dependencies
vi.mock('../../contexts/AuthContext');
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Navigate: (props) => {
      mockNavigate(props.to);
      return null;
    },
  };
});

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ session: null });
  });

  const renderWithRouter = (ui, { route = '/' } = {}) => {
    window.history.pushState({}, 'Test page', route);
    return render(ui, { wrapper: MemoryRouter });
  };

  it('should render the sign-in form by default', () => {
    renderWithRouter(<AuthPage />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should switch to the sign-up form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuthPage />);
    await user.click(screen.getByRole('button', { name: /sign up/i }));
    expect(screen.getByRole('heading', { name: /create an account/i })).toBeInTheDocument();
  });

  it('should switch to the forgot password form', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuthPage />);
    await user.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('heading', { name: /reset password/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('should call signInWithPassword on sign-in form submission', async () => {
    const user = userEvent.setup();
    let resolveSignIn;
    const signInPromise = new Promise(resolve => {
      resolveSignIn = resolve;
    });

    supabase.auth.signInWithPassword.mockReturnValue(signInPromise);

    renderWithRouter(<AuthPage />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const signInButton = screen.getByTestId('sign-in-button');

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');

    // Click the button
    await user.click(signInButton);

    // Immediately check if it's disabled (before resolving the promise)
    expect(signInButton).toBeDisabled();

    // Now resolve the promise
    resolveSignIn({ error: null });

    // Wait for the call
    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  it('should display a friendly error message on failed sign-in', async () => {
    const user = userEvent.setup();
    const error = { message: 'Invalid login credentials' };
    supabase.auth.signInWithPassword.mockResolvedValue({ error });
    renderWithRouter(<AuthPage />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('The email or password you entered is incorrect. Please try again.')).toBeInTheDocument();
  });

  it('should display a success message on sign-up', async () => {
    const user = userEvent.setup();
    supabase.auth.signUp.mockResolvedValue({ error: null });
    renderWithRouter(<AuthPage />);
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/password/i), 'new-password');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText('Success! Please check your email for a confirmation link to complete your registration.')).toBeInTheDocument();
  });

  it('should redirect to home if a session exists', () => {
    useAuth.mockReturnValue({ session: { user: { id: '123' } } });
    renderWithRouter(<AuthPage />);
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
