import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import ResetPasswordPage from '../ResetPasswordPage';
import * as supabaseClient from '@/lib/supabaseClient';

vi.mock('@/lib/supabaseClient');
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

describe('ResetPasswordPage (basic password-reset completion)', () => {
    const mockUpdateUser = vi.fn();
    const mockGetSession = vi.fn();
    const mockOnAuthStateChange = vi.fn();

    const setClient = () => {
        mockGetSupabaseClient.mockReturnValue({
            auth: {
                getSession: mockGetSession,
                updateUser: mockUpdateUser,
                onAuthStateChange: mockOnAuthStateChange,
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // A valid recovery session present by default (link was valid).
        mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'uuid-123' } } } });
        mockUpdateUser.mockResolvedValue({ error: null });
        mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
        setClient();
    });

    it('shows the set-new-password form (no username field) when the recovery link is valid', async () => {
        render(<ResetPasswordPage />);
        expect(await screen.findByTestId('set-new-password-form')).toBeInTheDocument();
        expect(screen.getByTestId('new-password-input')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-password-input')).toBeInTheDocument();
        // No username/handle anywhere in the reset flow.
        expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/handle/i)).not.toBeInTheDocument();
    });

    it('updates the password only after submit, then shows success copy', async () => {
        const user = userEvent.setup();
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');

        // Password must not have changed yet (no submit).
        expect(mockUpdateUser).not.toHaveBeenCalled();

        await user.type(screen.getByTestId('new-password-input'), 'newStrongPass1');
        await user.type(screen.getByTestId('confirm-password-input'), 'newStrongPass1');
        await user.click(screen.getByTestId('update-password-submit'));

        await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newStrongPass1' }));
        expect(await screen.findByTestId('reset-password-success')).toHaveTextContent(
            /your password has been updated\. you can sign in with your new password\./i,
        );
    });

    it('shows a safe invalid/expired message when there is no recovery session', async () => {
        mockGetSession.mockResolvedValue({ data: { session: null } });
        render(<ResetPasswordPage />);
        expect(await screen.findByTestId('reset-password-invalid')).toHaveTextContent(
            /this reset link is invalid or expired\. request a new password reset link\./i,
        );
        expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it('shows the safe invalid/expired message when the provider rejects the update (expired/used token)', async () => {
        const user = userEvent.setup();
        mockUpdateUser.mockResolvedValue({ error: { name: 'AuthApiError', message: 'token expired' } });
        render(<ResetPasswordPage />);
        await screen.findByTestId('set-new-password-form');

        await user.type(screen.getByTestId('new-password-input'), 'newStrongPass1');
        await user.type(screen.getByTestId('confirm-password-input'), 'newStrongPass1');
        await user.click(screen.getByTestId('update-password-submit'));

        expect(await screen.findByTestId('reset-password-invalid')).toBeInTheDocument();
        // The raw provider message/token is never surfaced to the user.
        expect(screen.queryByText(/token expired/i)).not.toBeInTheDocument();
    });

    it('rejects a too-short password before calling the provider', async () => {
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
