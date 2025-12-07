import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import SignInPage from '../SignInPage';
import * as AuthProvider from '@/contexts/AuthProvider';
import * as supabaseClient from '@/lib/supabaseClient';

// Mock modules
vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

describe('SignInPage', () => {
    const mockSetSession = vi.fn();
    const mockSignInWithPassword = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Default auth provider mock
        mockUseAuthProvider.mockReturnValue({
            session: null,
            loading: false,
            setSession: mockSetSession,
            user: null,
            profile: null,
            signOut: vi.fn(),
        });

        // Default Supabase client mock
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                signInWithPassword: mockSignInWithPassword,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    const renderSignInPage = () => {
        return render(
            <BrowserRouter>
                <SignInPage />
            </BrowserRouter>
        );
    };

    describe('Rendering', () => {
        it('should render the sign-in form', () => {
            renderSignInPage();

            expect(screen.getByText('SpeakSharp')).toBeInTheDocument();
            expect(screen.getByText('Welcome back')).toBeInTheDocument();
            expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
            expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
            expect(screen.getByTestId('sign-in-submit')).toBeInTheDocument();
        });

        it('should render loading spinner when auth is loading', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: true,
                setSession: mockSetSession,
                user: null,
                profile: null,
                signOut: vi.fn(),
            });

            renderSignInPage();

            const spinner = document.querySelector('.animate-spin');
            expect(spinner).toBeInTheDocument();
        });

        it('should redirect to home when user is already signed in', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } } as unknown as AuthProvider.AuthContextType['session'],
                loading: false,
                setSession: mockSetSession,
                user: { id: 'test-user' } as unknown as AuthProvider.AuthContextType['user'],
                profile: { id: 'test-profile' } as unknown as AuthProvider.AuthContextType['profile'],
                signOut: vi.fn(),
            });

            renderSignInPage();

            // Navigate component should render (redirecting)
            expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
        });

        it('should render link to sign-up page', () => {
            renderSignInPage();

            const signUpLink = screen.getByRole('link', { name: /create an account/i });
            expect(signUpLink).toHaveAttribute('href', '/auth/signup');
        });
    });

    describe('Form Validation', () => {
        it('should require email field', async () => {
            renderSignInPage();

            const emailInput = screen.getByLabelText(/email/i);
            expect(emailInput).toBeRequired();
        });

        it('should require password field', async () => {
            renderSignInPage();

            const passwordInput = screen.getByLabelText(/password/i);
            expect(passwordInput).toBeRequired();
        });

        it('should accept email input', async () => {
            const user = userEvent.setup();
            renderSignInPage();

            const emailInput = screen.getByLabelText(/email/i);
            await user.type(emailInput, 'test@example.com');

            expect(emailInput).toHaveValue('test@example.com');
        });

        it('should accept password input', async () => {
            const user = userEvent.setup();
            renderSignInPage();

            const passwordInput = screen.getByLabelText(/password/i);
            await user.type(passwordInput, 'password123');

            expect(passwordInput).toHaveValue('password123');
        });
    });

    describe('Form Submission', () => {
        it('should call signInWithPassword on form submit', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword.mockResolvedValue({
                data: { session: { user: { id: 'test-user' } } },
                error: null,
            });

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(mockSignInWithPassword).toHaveBeenCalledWith({
                    email: 'test@example.com',
                    password: 'password123',
                });
            });
        });

        it('should set session on successful sign-in', async () => {
            const user = userEvent.setup();
            const mockSession = { user: { id: 'test-user' } };
            mockSignInWithPassword.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(mockSetSession).toHaveBeenCalledWith(mockSession);
            });
        });

        it('should display error message on sign-in failure', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword.mockResolvedValue({
                data: { session: null },
                error: new Error('Invalid credentials'),
            });

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('Invalid credentials');
            });
        });

        it('should disable submit button while submitting', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');

            const submitButton = screen.getByTestId('sign-in-submit');
            await user.click(submitButton);

            expect(submitButton).toBeDisabled();
            expect(submitButton).toHaveTextContent('Signing in...');
        });

        it('should clear error message on new submission', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword
                .mockResolvedValueOnce({
                    data: { session: null },
                    error: new Error('Invalid credentials'),
                })
                .mockResolvedValueOnce({
                    data: { session: { user: { id: 'test-user' } } },
                    error: null,
                });

            renderSignInPage();

            // First attempt - fail
            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toBeInTheDocument();
            });

            // Second attempt - should clear error
            await user.clear(screen.getByLabelText(/password/i));
            await user.type(screen.getByLabelText(/password/i), 'correctpassword');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
            });
        });

        it('should handle unexpected errors gracefully', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword.mockRejectedValue(new Error('Network error'));

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('Network error');
            });
        });

        it('should handle non-Error exceptions', async () => {
            const user = userEvent.setup();
            mockSignInWithPassword.mockRejectedValue('String error');

            renderSignInPage();

            await user.type(screen.getByLabelText(/email/i), 'test@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-in-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('An unexpected error occurred');
            });
        });
    });
});
