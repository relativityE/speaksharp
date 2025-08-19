import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AuthPage from '../pages/AuthPage';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock the context
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// Mock the supabase client
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

describe('AuthPage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ session: null });
    supabase.auth.signUp.mockResolvedValue({ error: null });
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const getTitle = (name) => screen.getByText(name, { selector: 'div[data-slot="card-title"]' });

  it('should render Sign In form by default', () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    expect(getTitle(/sign in/i)).toBeInTheDocument();
  });

  it('should switch to Sign Up form when "Sign Up" is clicked', () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(getTitle(/create an account/i)).toBeInTheDocument();
  });

  it('should call signInWithPassword on sign in form submission', async () => {
    render(<AuthPage />, { wrapper: BrowserRouter });

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });
  });

  it('should call signUp on sign up form submission', async () => {
    render(<AuthPage />, { wrapper: BrowserRouter });

    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });
  });

  it('should switch to Forgot Password view when link is clicked', () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(getTitle(/reset password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('should call resetPasswordForEmail on forgot password form submission', async () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
        expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
            'test@example.com',
            expect.any(Object)
        );
    });
  });

  it('should display a user-friendly error message on failure', async () => {
    const errorMessage = 'Invalid login credentials';
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: errorMessage } });
    render(<AuthPage />, { wrapper: BrowserRouter });

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
        expect(screen.getByText('The email or password you entered is incorrect. Please try again.')).toBeInTheDocument();
    });
  });

  it('should redirect if user is already logged in', () => {
    useAuth.mockReturnValue({ session: { user: { id: '123' } } });
    render(
        <MemoryRouter initialEntries={['/auth']}>
            <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/" element={<div>Home Page</div>} />
            </Routes>
        </MemoryRouter>
    );
    expect(screen.getByText('Home Page')).toBeInTheDocument();
  });
});
