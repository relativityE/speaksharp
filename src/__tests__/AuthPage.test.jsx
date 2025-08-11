import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    },
  },
}));

describe('AuthPage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ session: null });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render Sign In form by default', () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    expect(screen.getByText(/sign in/i, { selector: 'div[data-slot="card-title"]' })).toBeInTheDocument();
  });

  it('should switch to Sign Up form when "Sign Up" is clicked', () => {
    render(<AuthPage />, { wrapper: BrowserRouter });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(screen.getByText(/create an account/i, { selector: 'div[data-slot="card-title"]' })).toBeInTheDocument();
  });

  it('should call signInWithPassword on sign in form submission', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
    render(<AuthPage />, { wrapper: BrowserRouter });

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password',
    });
  });

  it('should call signUp on sign up form submission', async () => {
    supabase.auth.signUp.mockResolvedValue({ error: null });
    render(<AuthPage />, { wrapper: BrowserRouter });

    // Switch to Sign Up form
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password',
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
