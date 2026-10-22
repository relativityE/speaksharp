import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../tests/support/test-utils';
import { ProfileGuard } from '../ProfileGuard';
import * as AuthProvider from '../../contexts/AuthProvider';
import * as UseUserProfile from '../../hooks/useUserProfile';
import type { UserProfile } from '../../types/user';

vi.mock('../../contexts/AuthProvider');
vi.mock('../../hooks/useUserProfile');

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const mockUseUserProfile = vi.mocked(UseUserProfile.useUserProfile);

const signedInSession = {
    user: { id: 'user-1', email: 'new-user@example.com' },
};

const profile: UserProfile = {
    id: 'user-1',
    subscription_status: 'pro',
    stripe_subscription_id: 'sub_123',
    usage_seconds: 0,
    usage_reset_date: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
};

describe('ProfileGuard', () => {
    const refetch = vi.fn();
    const signOut = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseAuthProvider.mockReturnValue({
            session: signedInSession,
            loading: false,
            signOut,
        } as unknown as AuthProvider.AuthContextType);
    });

    it('shows a friendly provisioning state for a new signed-in user before the profile row exists', () => {
        mockUseUserProfile.mockReturnValue({
            data: null,
            isLoading: false,
            error: null,
            refetch,
        } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);

        render(
            <ProfileGuard>
                <div>App content</div>
            </ProfileGuard>
        );

        expect(screen.getByTestId('profile-provisioning')).toHaveTextContent('Setting up your account');
        expect(screen.queryByText('Profile Sync Failed')).not.toBeInTheDocument();
        expect(screen.queryByText('App content')).not.toBeInTheDocument();
    });

    it('still shows the failure screen for a real profile fetch error', () => {
        mockUseUserProfile.mockReturnValue({
            data: null,
            isLoading: false,
            error: new Error('profile fetch failed'),
            refetch,
        } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);

        render(
            <ProfileGuard>
                <div>App content</div>
            </ProfileGuard>
        );

        expect(screen.getByTestId('app-error')).toHaveTextContent('Profile Sync Failed');
        expect(screen.queryByTestId('profile-provisioning')).not.toBeInTheDocument();
    });

    it('renders protected content once the profile is available', () => {
        mockUseUserProfile.mockReturnValue({
            data: profile,
            isLoading: false,
            error: null,
            refetch,
        } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);

        render(
            <ProfileGuard>
                <div>App content</div>
            </ProfileGuard>
        );

        expect(screen.getByText('App content')).toBeInTheDocument();
        expect(screen.queryByText('Profile Sync Failed')).not.toBeInTheDocument();
    });

    /**
     * Provisioning retry (P1, found while qualifying CO016): a signed-in user whose profile row never appears (the read
     * succeeds with no row and no error) must get a bounded number of re-reads and then the recoverable failure screen —
     * not an endless "Setting up your account" spinner. The retry used to fire once, because a re-read that again
     * returns null changed none of the effect's dependencies.
     */
    describe('provisioning retry for a missing profile row', () => {
        const ATTEMPTS = 5;
        const RETRY_MS = 1500;
        const missingRow = () => ({ data: null, isLoading: false, error: null, refetch }) as unknown as ReturnType<typeof UseUserProfile.useUserProfile>;
        const signedInAs = (id: string) => mockUseAuthProvider.mockReturnValue({
            session: { user: { id, email: `${id}@example.com` } },
            loading: false,
            signOut,
        } as unknown as AuthProvider.AuthContextType);
        const advanceAttempts = async (n: number) => {
            for (let i = 0; i < n; i += 1) {
                await act(async () => { vi.advanceTimersByTime(RETRY_MS); });
            }
        };
        const guarded = () => (
            <ProfileGuard>
                <div>App content</div>
            </ProfileGuard>
        );

        beforeEach(() => {
            vi.useFakeTimers();
            mockUseUserProfile.mockReturnValue(missingRow());
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('re-reads once per interval up to the bound, then shows Profile Sync Failed with its recovery actions', async () => {
            render(guarded());
            expect(screen.getByTestId('profile-provisioning')).toBeInTheDocument();

            await advanceAttempts(ATTEMPTS);

            expect(refetch, 'one re-read per provisioning attempt').toHaveBeenCalledTimes(ATTEMPTS);
            const failure = screen.getByTestId('app-error');
            expect(failure).toHaveTextContent('Profile Sync Failed');
            expect(screen.getByRole('button', { name: /Retry Sync/ })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Sign Out/ })).toBeInTheDocument();
            expect(screen.queryByTestId('profile-provisioning')).not.toBeInTheDocument();
            expect(screen.queryByText('App content')).not.toBeInTheDocument();

            // The bound holds: no further automatic re-reads once the failure screen is shown.
            await advanceAttempts(3);
            expect(refetch).toHaveBeenCalledTimes(ATTEMPTS);
        });

        it('Retry Sync on the exhausted screen re-reads, and a profile that then arrives renders the app', async () => {
            const { rerender } = render(guarded());
            await advanceAttempts(ATTEMPTS);
            expect(screen.getByTestId('app-error')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: /Retry Sync/ }));
            expect(refetch).toHaveBeenCalledTimes(ATTEMPTS + 1);

            mockUseUserProfile.mockReturnValue({ data: profile, isLoading: false, error: null, refetch } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);
            rerender(guarded());
            expect(screen.getByText('App content')).toBeInTheDocument();
            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
        });

        it('a profile row that arrives part-way through provisioning renders the app and stops the retries', async () => {
            const { rerender } = render(guarded());
            await advanceAttempts(2);
            expect(refetch).toHaveBeenCalledTimes(2);

            mockUseUserProfile.mockReturnValue({ data: profile, isLoading: false, error: null, refetch } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);
            rerender(guarded());
            expect(screen.getByText('App content')).toBeInTheDocument();

            await advanceAttempts(ATTEMPTS);
            expect(refetch, 'no re-reads once the profile exists').toHaveBeenCalledTimes(2);
        });

        it('a different account starts its own bounded provisioning instead of inheriting the previous failure', async () => {
            signedInAs('user-1');
            const { rerender } = render(guarded());
            await advanceAttempts(ATTEMPTS);
            expect(screen.getByTestId('app-error')).toBeInTheDocument();

            signedInAs('user-2');
            rerender(guarded());
            expect(screen.getByTestId('profile-provisioning')).toBeInTheDocument();
            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();

            await advanceAttempts(ATTEMPTS);
            expect(refetch, 'the new account gets its own full set of re-reads').toHaveBeenCalledTimes(ATTEMPTS * 2);
            expect(screen.getByTestId('app-error')).toBeInTheDocument();
        });

        it('unmounting cancels the pending re-read', async () => {
            const { unmount } = render(guarded());
            unmount();
            await advanceAttempts(ATTEMPTS);
            expect(refetch).not.toHaveBeenCalled();
        });
    });
});
