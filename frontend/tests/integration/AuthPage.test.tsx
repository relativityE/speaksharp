import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import AuthPage from '@/pages/AuthPage';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { AuthContext, AuthContextType } from '@/contexts/AuthProvider';

// Mock AuthProvider context
const mockAuthContextValue: Partial<AuthContextType> = {
    user: null,
    session: null,
    loading: false,
    signOut: vi.fn(),
    setSession: vi.fn(),
};

const MockAuthProvider: React.FC<{ children: React.ReactNode; value?: Partial<AuthContextType> }> = ({
    children,
    value = mockAuthContextValue,
}) => {
    return <AuthContext.Provider value={value as AuthContextType}>{children}</AuthContext.Provider>;
};

// Mock Supabase
vi.mock('@/lib/supabaseClient');
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
    },
}));

const mockSupabaseClient = {
    auth: {
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        resetPasswordForEmail: vi.fn(),
        signInWithOAuth: vi.fn(),
    },
};

describe('AuthPage Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (getSupabaseClient as any).mockReturnValue(mockSupabaseClient);

        // Reset mock context to ensure form renders
        mockAuthContextValue.user = null;
        mockAuthContextValue.session = null;
        mockAuthContextValue.loading = false;
    });

    afterEach(() => {
        if (global.gc) {
            global.gc();
        }
    });

    describe('Sign In Flow', () => {
        it('renders sign-in form by default', () => {
            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            expect(screen.getByText(/Welcome Back/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
        });

        it('validates email format', async () => {
            const user = userEvent.setup();
            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            const emailInput = screen.getByPlaceholderText(/email/i);
            const passwordInput = screen.getByPlaceholderText(/password/i);

            await user.type(emailInput, 'invalid-email');
            await user.type(passwordInput, 'password123');
            await user.click(screen.getByRole('button', { name: /sign in/i }));

            // Form should show validation error
            expect(mockSupabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
        });

        it('calls signInWithPassword with valid credentials', async () => {
            const user = userEvent.setup();
            mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
                data: { user: { id: 'test-user' }, session: { access_token: 'test-token' } },
                error: null,
            });

            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.type(screen.getByPlaceholderText(/email/i), 'test@example.com');
            await user.type(screen.getByPlaceholderText(/password/i), 'password123');
            await user.click(screen.getByRole('button', { name: /sign in/i }));

            await waitFor(() => {
                expect(mockSupabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
                    email: 'test@example.com',
                    password: 'password123',
                });
            });
        });

        it('displays error on failed sign-in', async () => {
            const user = userEvent.setup();
            mockSupabaseClient.auth.signInWithPassword.mockResolvedValue({
                data: null,
                error: { message: 'Invalid login credentials' },
            });

            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.type(screen.getByPlaceholderText(/email/i), 'test@example.com');
            await user.type(screen.getByPlaceholderText(/password/i), 'wrongpassword');
            await user.click(screen.getByRole('button', { name: /sign in/i }));

            await waitFor(() => {
                expect(screen.getByText(/invalid login credentials/i)).toBeInTheDocument();
            });
        });
    });

    describe('Sign Up Flow', () => {
        it('switches to sign-up form when clicking sign-up link', async () => {
            const user = userEvent.setup();
            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.click(screen.getByText(/create an account/i));

            expect(screen.getByText(/create account/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
        });

        it('validates password strength for sign-up', async () => {
            const user = userEvent.setup();
            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.click(screen.getByText(/create an account/i));

            const emailInput = screen.getByPlaceholderText(/email/i);
            const passwordInput = screen.getByPlaceholderText(/password/i);

            await user.type(emailInput, 'newuser@example.com');
            await user.type(passwordInput, '123'); // Too short
            await user.click(screen.getByRole('button', { name: /sign up/i }));

            // Should show password strength error
            expect(mockSupabaseClient.auth.signUp).not.toHaveBeenCalled();
        });

        it('calls signUp with valid credentials', async () => {
            const user = userEvent.setup();
            mockSupabaseClient.auth.signUp.mockResolvedValue({
                data: { user: { id: 'new-user' }, session: null },
                error: null,
            });

            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.click(screen.getByText(/create an account/i));

            await user.type(screen.getByPlaceholderText(/email/i), 'newuser@example.com');
            await user.type(screen.getByPlaceholderText(/password/i), 'StrongPass123!');
            await user.click(screen.getByRole('button', { name: /sign up/i }));

            await waitFor(() => {
                expect(mockSupabaseClient.auth.signUp).toHaveBeenCalledWith({
                    email: 'newuser@example.com',
                    password: 'StrongPass123!',
                });
            });
        });
    });

    describe('Password Reset Flow', () => {
        it('switches to password reset form', async () => {
            const user = userEvent.setup();
            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.click(screen.getByText(/forgot password/i));

            expect(screen.getByText(/reset password/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
        });

        it('sends password reset email', async () => {
            const user = userEvent.setup();
            mockSupabaseClient.auth.resetPasswordForEmail.mockResolvedValue({
                data: {},
                error: null,
            });

            render(
                <BrowserRouter>
                    <MockAuthProvider>
                        <AuthPage />
                    </MockAuthProvider>
                </BrowserRouter>
            );

            await user.click(screen.getByText(/forgot password/i));
            await user.type(screen.getByPlaceholderText(/email/i), 'reset@example.com');
            await user.click(screen.getByRole('button', { name: /send reset email/i }));

            await waitFor(() => {
                expect(mockSupabaseClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
                    'reset@example.com',
                    expect.any(Object)
                );
            });
        });
    });
});
