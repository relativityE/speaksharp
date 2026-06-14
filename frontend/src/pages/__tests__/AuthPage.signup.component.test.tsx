import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import AuthPage from '../AuthPage';
import * as AuthProvider from '@/contexts/AuthProvider';
import * as supabaseClient from '@/lib/supabaseClient';

vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockGetSupabaseClient = vi.mocked(supabaseClient.getSupabaseClient);

describe('AuthPage signup email validation', () => {
    const mockSignUp = vi.fn();
    const mockSignInWithPassword = vi.fn();

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
                signInWithPassword: mockSignInWithPassword,
                signUp: mockSignUp,
                resetPasswordForEmail: vi.fn(),
            },
        } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
    });

    it('blocks blank signup email before calling Supabase', async () => {
        const user = userEvent.setup();
        render(<AuthPage />, { route: '/auth/signup', path: '/auth/signup' });

        await user.type(screen.getByTestId('password-input'), 'validpass123');
        await user.click(screen.getByTestId('sign-up-submit'));

        expect(await screen.findByTestId('signup-inline-error')).toHaveTextContent('Email not valid');
        expect(mockSignUp).not.toHaveBeenCalled();
        expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it('blocks malformed signup email before calling Supabase', async () => {
        const user = userEvent.setup();
        render(<AuthPage />, { route: '/auth/signup', path: '/auth/signup' });

        await user.type(screen.getByTestId('email-input'), 'not-an-email');
        await user.type(screen.getByTestId('password-input'), 'validpass123');
        fireEvent.submit(screen.getByTestId('auth-form'));

        expect(await screen.findByTestId('signup-inline-error')).toHaveTextContent('Email not valid');
        expect(mockSignUp).not.toHaveBeenCalled();
        expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });
});
