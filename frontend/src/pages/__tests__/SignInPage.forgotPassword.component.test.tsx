import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import SignInPage from '../SignInPage';
import * as AuthProvider from '@/contexts/AuthProvider';
import * as supabaseClient from '@/lib/supabaseClient';

vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

const NEUTRAL = /if an account exists for this email, we'll send reset instructions\./i;

describe('SignInPage — forgot password from the primary sign-in page (P1, anti-enumeration)', () => {
    const mockResetPasswordForEmail = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuthProvider.mockReturnValue({
            session: null, loading: false, setSession: vi.fn(), user: null, signOut: vi.fn(),
        } as unknown as ReturnType<typeof AuthProvider.useAuthProvider>);
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                signInWithPassword: vi.fn(),
                signInWithOtp: vi.fn(),
                resetPasswordForEmail: mockResetPasswordForEmail,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    it('exposes a Forgot password control on /auth/signin', () => {
        render(<SignInPage />);
        expect(screen.getByTestId('forgot-password-button')).toBeInTheDocument();
    });

    it('sends the reset to /auth/reset and shows the neutral response (account exists)', async () => {
        const user = userEvent.setup();
        mockResetPasswordForEmail.mockResolvedValue({ error: null });
        render(<SignInPage />);

        await user.type(screen.getByTestId('email-input'), 'real@example.com');
        await user.click(screen.getByTestId('forgot-password-button'));

        await waitFor(() => expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1));
        const [, opts] = mockResetPasswordForEmail.mock.calls[0];
        expect(opts.redirectTo).toMatch(/\/auth\/reset$/);
        expect(await screen.findByTestId('auth-message')).toHaveTextContent(NEUTRAL);
        expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
    });

    it('shows the SAME neutral response when the provider errors (no enumeration)', async () => {
        const user = userEvent.setup();
        mockResetPasswordForEmail.mockResolvedValue({ error: { name: 'AuthApiError', message: 'whatever' } });
        render(<SignInPage />);

        await user.type(screen.getByTestId('email-input'), 'unknown@example.com');
        await user.click(screen.getByTestId('forgot-password-button'));

        await waitFor(() => expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1));
        expect(await screen.findByTestId('auth-message')).toHaveTextContent(NEUTRAL);
        expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
        expect(screen.queryByText(/whatever|not found|no account/i)).not.toBeInTheDocument();
    });

    it('does not call the provider with an empty email (prompts to enter one, no enumeration)', async () => {
        const user = userEvent.setup();
        render(<SignInPage />);
        await user.click(screen.getByTestId('forgot-password-button'));
        expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
        expect(await screen.findByTestId('auth-error-message')).toHaveTextContent(/enter your email/i);
    });
});
