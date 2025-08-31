import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

  it('should switch to the sign-up form', () => {
    renderWithRouter(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(screen.getByRole('heading', { name: /create an account/i })).toBeInTheDocument();
  });

  it('should switch to the forgot password form', () => {
    renderWithRouter(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('heading', { name: /reset password/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('should call signInWithPassword on sign-in form submission', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
    renderWithRouter(<AuthPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const processingButton = await screen.findByRole('button', { name: /processing.../i });
    expect(processingButton).toBeDisabled();

    // Ensure the async operation inside handleSubmit completes
    await act(async () => {
        await Promise.resolve();
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password',
    });
  });

  it('should display a friendly error message on failed sign-in', async () => {
    const error = { message: 'Invalid login credentials' };
    supabase.auth.signInWithPassword.mockResolvedValue({ error });
    renderWithRouter(<AuthPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('The email or password you entered is incorrect. Please try again.')).toBeInTheDocument();
  });

  it('should display a success message on sign-up', async () => {
    supabase.auth.signUp.mockResolvedValue({ error: null });
    renderWithRouter(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText('Success! Please check your email for a confirmation link to complete your registration.')).toBeInTheDocument();
  });

  it('should redirect to home if a session exists', () => {
    useAuth.mockReturnValue({ session: { user: { id: '123' } } });
    renderWithRouter(<AuthPage />);
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
