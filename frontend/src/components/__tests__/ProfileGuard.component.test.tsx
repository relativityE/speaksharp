import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../tests/support/test-utils';
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
});
