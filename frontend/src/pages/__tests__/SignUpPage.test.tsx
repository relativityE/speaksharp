import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SignUpPage from '../SignUpPage';
import * as AuthProvider from '@/contexts/AuthProvider';
import * as supabaseClient from '@/lib/supabaseClient';

// Mock modules
vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

describe('SignUpPage', () => {
    const mockSetSession = vi.fn();
    const mockSignUp = vi.fn();
    const mockSignInWithPassword = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Default auth provider mock
        mockUseAuthProvider.mockReturnValue({
            session: null,
            loading: false,
            setSession: mockSetSession,
            user: null,
            signOut: vi.fn(),
        });

        // Default Supabase client mock
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                signUp: mockSignUp,
                signInWithPassword: mockSignInWithPassword,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    const renderSignUpPage = () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                },
            },
        });
        return render(
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <SignUpPage />
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    describe('Rendering', () => {
        it('should render the sign-up form', () => {
            renderSignUpPage();

            expect(screen.getByText('SpeakSharp')).toBeInTheDocument();
            expect(screen.getByText('Create an account')).toBeInTheDocument();
            expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
            expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
            expect(screen.getByTestId('sign-up-submit')).toBeInTheDocument();
        });

        it('should render loading spinner when auth is loading', () => {
            mockUseAuthProvider.mockReturnValue({
                session: null,
                loading: true,
                setSession: mockSetSession,
                user: null,
                signOut: vi.fn(),
            });

            renderSignUpPage();

            const spinner = document.querySelector('.animate-spin');
            expect(spinner).toBeInTheDocument();
        });

        it('should redirect to home when user is already signed in', () => {
            mockUseAuthProvider.mockReturnValue({
                session: { user: { id: 'test-user' } } as unknown as AuthProvider.AuthContextType['session'],
                loading: false,
                setSession: mockSetSession,
                user: { id: 'test-user' } as unknown as AuthProvider.AuthContextType['user'],
                signOut: vi.fn(),
            });

            renderSignUpPage();

            expect(screen.queryByText('Create an account')).not.toBeInTheDocument();
        });

        it('should render link to sign-in page', () => {
            renderSignUpPage();

            const signInLink = screen.getByRole('link', { name: /sign in/i });
            expect(signInLink).toHaveAttribute('href', '/auth/signin');
        });
    });

    describe('Form Validation', () => {
        it('should require email field', () => {
            renderSignUpPage();

            const emailInput = screen.getByLabelText(/email/i);
            expect(emailInput).toBeRequired();
        });

        it('should require password field', () => {
            renderSignUpPage();

            const passwordInput = screen.getByLabelText(/password/i);
            expect(passwordInput).toBeRequired();
        });

        it('should accept email input', async () => {
            const user = userEvent.setup();
            renderSignUpPage();

            const emailInput = screen.getByLabelText(/email/i);
            await user.type(emailInput, 'newuser@example.com');

            expect(emailInput).toHaveValue('newuser@example.com');
        });

        it('should accept password input', async () => {
            const user = userEvent.setup();
            renderSignUpPage();

            const passwordInput = screen.getByLabelText(/password/i);
            await user.type(passwordInput, 'securepassword123');

            expect(passwordInput).toHaveValue('securepassword123');
        });
    });

    describe('Form Submission - Auto-confirm Flow', () => {
        it('should call signUp and signIn on form submit', async () => {
            const user = userEvent.setup();
            const mockSession = { user: { id: 'new-user' } };

            mockSignUp.mockResolvedValue({ error: null });
            mockSignInWithPassword.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(mockSignUp).toHaveBeenCalledWith({
                    email: 'newuser@example.com',
                    password: 'password123',
                });
                expect(mockSignInWithPassword).toHaveBeenCalledWith({
                    email: 'newuser@example.com',
                    password: 'password123',
                });
            });
        });

        it('should set session on successful auto-confirm sign-up', async () => {
            const user = userEvent.setup();
            const mockSession = { user: { id: 'new-user' } };

            mockSignUp.mockResolvedValue({ error: null });
            mockSignInWithPassword.mockResolvedValue({
                data: { session: mockSession },
                error: null,
            });

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(mockSetSession).toHaveBeenCalledWith(mockSession);
            });
        });

        it('should show confirmation message when email verification required', async () => {
            const user = userEvent.setup();

            mockSignUp.mockResolvedValue({ error: null });
            mockSignInWithPassword.mockResolvedValue({
                data: { session: null },
                error: null,
            });

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-message')).toHaveTextContent(
                    'Success! Please check your email for a confirmation link.'
                );
            });
        });

        it('should display error message on sign-up failure', async () => {
            const user = userEvent.setup();
            const signUpError = new Error('User already registered');
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: signUpError,
            });

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'existing@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('User already registered');
            });
        });

        it('should disable submit button while submitting', async () => {
            const user = userEvent.setup();
            mockSignUp.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');

            const submitButton = screen.getByTestId('sign-up-submit');
            await user.click(submitButton);

            expect(submitButton).toBeDisabled();
            expect(submitButton).toHaveTextContent('Creating account...');
        });

        it('should handle missing Supabase client', async () => {
            const user = userEvent.setup();
            mockGetSupabaseClient.mockReturnValue(null as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('Supabase client not available');
            });
        });

        it('should clear error message on new submission', async () => {
            const user = userEvent.setup();
            const signUpError = new Error('User already registered');
            mockSignUp
                .mockResolvedValueOnce({
                    data: { user: null, session: null },
                    error: signUpError
                })
                .mockResolvedValueOnce({
                    data: { user: null, session: null },
                    error: null
                });
            mockSignInWithPassword.mockResolvedValue({
                data: { session: { user: { id: 'new-user' } } },
                error: null,
            });

            renderSignUpPage();

            // First attempt - fail
            await user.type(screen.getByLabelText(/email/i), 'existing@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toBeInTheDocument();
            });

            // Second attempt - should clear error
            await user.clear(screen.getByLabelText(/email/i));
            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
            });
        });

        it('should handle unexpected errors gracefully', async () => {
            const user = userEvent.setup();
            mockSignUp.mockRejectedValue(new Error('Network error'));

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('Network error');
            });
        });

        it('should handle non-Error exceptions', async () => {
            const user = userEvent.setup();
            mockSignUp.mockRejectedValue('String error');

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(screen.getByTestId('auth-error-message')).toHaveTextContent('An unexpected error occurred');
            });
        });

        it('should log errors to console', async () => {
            const user = userEvent.setup();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const testError = new Error('Test error');
            mockSignUp.mockRejectedValue(testError);

            renderSignUpPage();

            await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
            await user.type(screen.getByLabelText(/password/i), 'password123');
            await user.click(screen.getByTestId('sign-up-submit'));

            await waitFor(() => {
                expect(consoleErrorSpy).toHaveBeenCalledWith('[AUTH] Error during sign up', testError);
            });

            consoleErrorSpy.mockRestore();
        });
    });
});
