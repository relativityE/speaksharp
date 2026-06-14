import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import ResetPasswordPage from '../ResetPasswordPage';
import * as supabaseClient from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient');
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

describe('ResetPasswordPage (basic password-reset completion)', () => {
    const mockUpdateUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockOnAuthStateChange = vi.fn();
    let authCb: ((event: string, session?: unknown) => void) | null = null;

    const setRecoveryHash = () => { window.location.hash = '#access_token=abc&type=recovery&refresh_token=def'; };
    const clearHash = () => { window.location.hash = ''; };

    beforeEach(() => {
        vi.clearAllMocks();
        clearHash();
        authCb = null;
        mockUpdateUser.mockResolvedValue({ error: null });
        // Default: a session EXISTS — used to prove it is NOT sufficient authority without a recovery flow.
        mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'uuid-123' } } } });
        mockOnAuthStateChange.mockImplementation((cb: (event: string, session?: unknown) => void) => {
            authCb = cb;
            return { data: { subscription: { unsubscribe: vi.fn() } } };
        });
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                getSession: mockGetSession,
                updateUser: mockUpdateUser,
                onAuthStateChange: mockOnAuthStateChange,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    afterEach(() => clearHash());

    it('shows the set-new-password form (no username field) when arriving via a recovery link', async () => {
        setRecoveryHash();
        render(<ResetPasswordPage />);
        expect(await screen.findByTestId('set-new-password-form')).toBeInTheDocument();
        expect(screen.getByTestId('new-password-input')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-password-input')).toBeInTheDocument();
        expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    });

    it('authorizes the form via a PASSWORD_RECOVERY auth event (no persisted-session authority needed)', async () => {
        render(<ResetPasswordPage />); // no recovery hash yet
        await screen.findByTestId('reset-password-invalid');
        await act(async () => { authCb?.('PASSWORD_RECOVERY', { user: { id: 'uuid-123' } }); });
        expect(await screen.findByTestId('set-new-password-form')).toBeInTheDocument();
    });

    it('SECURITY: a normal signed-in session is NOT reset authority without a recovery flow', async () => {
        // Session exists (getSession resolves a session) but there is no recovery token and no
        // PASSWORD_RECOVERY event → must NOT allow password change.
        render(<ResetPasswordPage />);
        expect(await screen.findByTestId('reset-password-invalid')).toBeInTheDocument();
        expect(screen.queryByTestId('set-new-password-form')).not.toBeInTheDocument();
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('shows the safe invalid/expired message on a direct visit with no recovery token', async () => {
        mockGetSession.mockResolvedValue({ data: { session: null } });
        render(<ResetPasswordPage />);
        expect(await screen.findByTestId('reset-password-invalid')).toHaveTextContent(
            /this reset link is invalid or expired\. request a new password reset link\./i,
        );
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('updates the password only after submit, then shows success copy', async () => {
        setRecoveryHash();
        const user = userEvent.setup();
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');
        expect(mockUpdateUser).not.toHaveBeenCalled();

        await user.type(screen.getByTestId('new-password-input'), 'newStrongPass1');
        await user.type(screen.getByTestId('confirm-password-input'), 'newStrongPass1');
        await user.click(screen.getByTestId('update-password-submit'));

        await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newStrongPass1' }));
        expect(await screen.findByTestId('reset-password-success')).toHaveTextContent(
            /your password has been updated\. you can sign in with your new password\./i,
        );
    });

    it('shows the safe invalid/expired message when the provider rejects the update (expired/used token)', async () => {
        setRecoveryHash();
        mockUpdateUser.mockResolvedValue({ error: { name: 'AuthApiError', message: 'token expired' } });
        const user = userEvent.setup();
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');

        await user.type(screen.getByTestId('new-password-input'), 'newStrongPass1');
        await user.type(screen.getByTestId('confirm-password-input'), 'newStrongPass1');
        await user.click(screen.getByTestId('update-password-submit'));

        expect(await screen.findByTestId('reset-password-invalid')).toBeInTheDocument();
        expect(screen.queryByText(/token expired/i)).not.toBeInTheDocument();
    });

    it('rejects a too-short password before calling the provider', async () => {
        setRecoveryHash();
        const user = userEvent.setup();
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');

        await user.type(screen.getByTestId('new-password-input'), '123');
        await user.type(screen.getByTestId('confirm-password-input'), '123');
        await user.click(screen.getByTestId('update-password-submit'));

        expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(/at least 6 characters/i);
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('rejects mismatched passwords before calling the provider', async () => {
        setRecoveryHash();
        const user = userEvent.setup();
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');

        await user.type(screen.getByTestId('new-password-input'), 'newStrongPass1');
        await user.type(screen.getByTestId('confirm-password-input'), 'differentPass1');
        await user.click(screen.getByTestId('update-password-submit'));

        expect(await screen.findByTestId('reset-password-error')).toHaveTextContent(/do not match/i);
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });
});
