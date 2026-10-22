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
            refetch.mockReset();
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

        // Sam RETURN on 24d5a9ac, gap 1: an exhausted account must not come back exhausted after an identity change.
        it('A exhausted, then B, then A again before B re-reads: A starts a fresh provisioning, not the old failure', async () => {
            signedInAs('user-1');
            const { rerender } = render(guarded());
            await advanceAttempts(ATTEMPTS);
            expect(screen.getByTestId('app-error')).toBeInTheDocument();

            signedInAs('user-2');
            rerender(guarded());
            signedInAs('user-1');
            rerender(guarded());

            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
            expect(screen.getByTestId('profile-provisioning')).toBeInTheDocument();
        });

        it('A exhausted, signed out, then A signs back in: A starts a fresh provisioning, not the old failure', async () => {
            signedInAs('user-1');
            const { rerender } = render(guarded());
            await advanceAttempts(ATTEMPTS);
            expect(screen.getByTestId('app-error')).toBeInTheDocument();

            mockUseAuthProvider.mockReturnValue({ session: null, loading: false, signOut } as unknown as AuthProvider.AuthContextType);
            rerender(guarded());
            signedInAs('user-1');
            rerender(guarded());

            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
            expect(screen.getByTestId('profile-provisioning')).toBeInTheDocument();
        });

        // Sam RETURN on 24d5a9ac, gap 2: an attempt counts only once its re-read settles, and reads never overlap.
        const SLOW_READ_MS = 4000;
        const slowRead = () => new Promise<void>((resolve) => { setTimeout(resolve, SLOW_READ_MS); });

        it('a slow re-read is never overlapped by another automatic re-read', async () => {
            refetch.mockImplementation(slowRead);
            render(guarded());

            await advanceAttempts(1);
            expect(refetch).toHaveBeenCalledTimes(1);
            // Well past another retry interval while the first read is still outstanding.
            await act(async () => { vi.advanceTimersByTime(SLOW_READ_MS - 500); });
            expect(refetch, 'no second dispatch while the first read is in flight').toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
        });

        it("a slow read from the previous account settling after a switch is ignored: it neither counts for the new account nor frees an overlapping read", async () => {
            refetch.mockImplementation(slowRead);
            signedInAs('user-1');
            const { rerender } = render(guarded());
            await act(async () => { vi.advanceTimersByTime(RETRY_MS); }); // t=1.5 s: user-1 read #1 dispatched, settles at 5.5 s
            expect(refetch).toHaveBeenCalledTimes(1);

            await act(async () => { vi.advanceTimersByTime(500); }); // t=2.0 s: switch accounts
            signedInAs('user-2');
            rerender(guarded());
            await act(async () => { vi.advanceTimersByTime(RETRY_MS); }); // t=3.5 s: user-2 read #1 dispatched, settles at 7.5 s
            expect(refetch).toHaveBeenCalledTimes(2);

            // t=5.6 s: user-1's stale read has settled (5.5 s). Advancing in two steps lets React run any effect that settle
            // would re-arm. Had it counted, user-2 would dispatch again at 7.0 s while its own read was still in flight.
            await act(async () => { vi.advanceTimersByTime(2100); });
            await act(async () => { vi.advanceTimersByTime(1600); }); // t=7.2 s
            expect(refetch, 'no overlapping read for user-2 after the stale settle').toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('profile-provisioning')).toBeInTheDocument();
        });

        it('a successful fifth read that settles slowly renders the app without a premature failure screen', async () => {
            let calls = 0;
            refetch.mockImplementation(() => {
                calls += 1;
                if (calls < ATTEMPTS) return slowRead();
                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        mockUseUserProfile.mockReturnValue({ data: profile, isLoading: false, error: null, refetch } as unknown as ReturnType<typeof UseUserProfile.useUserProfile>);
                        resolve();
                    }, SLOW_READ_MS);
                });
            });
            render(guarded());

            // Four reads dispatch and settle (interval + slow settle each), then the fifth dispatches.
            for (let i = 0; i < ATTEMPTS; i += 1) {
                await act(async () => { vi.advanceTimersByTime(RETRY_MS); });
                expect(screen.queryByTestId('app-error'), `no failure screen while read ${i + 1} is outstanding`).not.toBeInTheDocument();
                if (i < ATTEMPTS - 1) await act(async () => { vi.advanceTimersByTime(SLOW_READ_MS); });
            }
            expect(refetch).toHaveBeenCalledTimes(ATTEMPTS);
            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();

            await act(async () => { vi.advanceTimersByTime(SLOW_READ_MS); });
            expect(screen.getByText('App content')).toBeInTheDocument();
            expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
        });
    });
});
