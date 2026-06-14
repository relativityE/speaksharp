import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import AuthPage from '../AuthPage';
import * as AuthProvider from '@/contexts/AuthProvider';
import * as supabaseClient from '@/lib/supabaseClient';

vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

const NEUTRAL = /if an account exists for this email, we'll send reset instructions\./i;

describe('AuthPage — forgot password (anti-enumeration)', () => {
    const mockResetPasswordForEmail = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuthProvider.mockReturnValue({
            session: null,
            loading: false,
            setSession: vi.fn(),
            user: null,
            signOut: vi.fn(),
        } as unknown as ReturnType<typeof AuthProvider.useAuthProvider>);
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                signInWithPassword: vi.fn(),
                signUp: vi.fn(),
                resetPasswordForEmail: mockResetPasswordForEmail,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    const openForgotPassword = async (user: ReturnType<typeof userEvent.setup>) => {
        render(<AuthPage />);
        await user.click(screen.getByTestId('forgot-password-button'));
        expect(await screen.findByTestId('reset-password-form')).toBeInTheDocument();
    };

    it('shows the forgot-password form with only an email field (no username, no password)', async () => {
        const user = userEvent.setup();
        await openForgotPassword(user);
        expect(screen.getByTestId('email-input')).toBeInTheDocument();
        expect(screen.queryByTestId('password-input')).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    });

    it('shows the neutral response and targets the /auth/reset completion route when an account exists', async () => {
        const user = userEvent.setup();
        mockResetPasswordForEmail.mockResolvedValue({ error: null });
        await openForgotPassword(user);

        await user.type(screen.getByTestId('email-input'), 'real@example.com');
        await user.click(screen.getByTestId('sign-in-submit'));

        await waitFor(() => expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1));
        const [, opts] = mockResetPasswordForEmail.mock.calls[0];
        expect(opts.redirectTo).toMatch(/\/auth\/reset$/);
        expect(await screen.findByText(NEUTRAL)).toBeInTheDocument();
        expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
    });

    it('shows the SAME neutral response when the provider returns an error (no enumeration)', async () => {
        const user = userEvent.setup();
        mockResetPasswordForEmail.mockResolvedValue({ error: { name: 'AuthApiError', message: 'whatever' } });
        await openForgotPassword(user);

        await user.type(screen.getByTestId('email-input'), 'unknown@example.com');
        await user.click(screen.getByTestId('sign-in-submit'));

        await waitFor(() => expect(mockResetPasswordForEmail).toHaveBeenCalledTimes(1));
        // Identical neutral message; the provider error is never surfaced.
        expect(await screen.findByText(NEUTRAL)).toBeInTheDocument();
        expect(screen.queryByTestId('auth-error-message')).not.toBeInTheDocument();
        expect(screen.queryByText(/whatever|not found|no account|doesn't exist/i)).not.toBeInTheDocument();
    });

    it('does not reveal account existence: existing and non-existing inputs render the same message', async () => {
        // existing
        const user1 = userEvent.setup();
        mockResetPasswordForEmail.mockResolvedValue({ error: null });
        const { unmount } = render(<AuthPage />);
        await user1.click(screen.getByTestId('forgot-password-button'));
        await user1.type(screen.getByTestId('email-input'), 'real@example.com');
        await user1.click(screen.getByTestId('sign-in-submit'));
        const existingMsg = (await screen.findByText(NEUTRAL)).textContent;
        unmount();

        // non-existing
        vi.clearAllMocks();
        mockUseAuthProvider.mockReturnValue({ session: null, loading: false, setSession: vi.fn(), user: null, signOut: vi.fn() } as unknown as ReturnType<typeof AuthProvider.useAuthProvider>);
        mockGetSupabaseClient.mockReturnValue({ auth: { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { name: 'AuthApiError' } }) } } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
        const user2 = userEvent.setup();
        render(<AuthPage />);
        await user2.click(screen.getByTestId('forgot-password-button'));
        await user2.type(screen.getByTestId('email-input'), 'nobody@example.com');
        await user2.click(screen.getByTestId('sign-in-submit'));
        const nonExistingMsg = (await screen.findByText(NEUTRAL)).textContent;

        expect(nonExistingMsg).toBe(existingMsg);
    });
});
