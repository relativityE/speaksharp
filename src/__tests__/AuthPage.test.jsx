import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const renderWithRouter = (ui, { route = '/' } = {}) => {
    window.history.pushState({}, 'Test page', route)

    return render(ui, { wrapper: BrowserRouter })
}


describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render Sign In form by default', () => {
    useAuth.mockReturnValue({ session: null });
    renderWithRouter(<AuthPage />);
    expect(screen.getByRole('heading', { level: 1, name: /sign in/i })).toBeInTheDocument();
  });

  it('should switch to Sign Up form when "Sign Up" is clicked', () => {
    useAuth.mockReturnValue({ session: null });
    renderWithRouter(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i, type: 'button' }));

    expect(screen.getByRole('heading', { level: 1, name: /sign up/i })).toBeInTheDocument();
  });

  it('should call signInWithPassword on sign in form submission', async () => {
    useAuth.mockReturnValue({ session: null });
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
    renderWithRouter(<AuthPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i, type: 'submit' }));

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password',
    });
  });

  it('should call signUp on sign up form submission', async () => {
    useAuth.mockReturnValue({ session: null });
    supabase.auth.signUp.mockResolvedValue({ error: null });
    renderWithRouter(<AuthPage />);

    // Switch to Sign Up form
    fireEvent.click(screen.getByRole('button', { name: /sign up/i, type: 'button' }));

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign up/i, type: 'submit' }));

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
