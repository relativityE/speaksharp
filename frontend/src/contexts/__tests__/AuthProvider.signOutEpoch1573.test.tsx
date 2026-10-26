/**
 * #1573 Codex P1 4223862191 — SIGN-OUT INTENT INVALIDATES BOUND WORK AT ONCE.
 *
 * Async work such as a session PDF is bound to the auth epoch (`loginSessionLog`). `signOut()` used to move it only when
 * Supabase later emitted SIGNED_OUT, so a slow, failing or event-less sign-out left the guard true after the app had shown
 * the signed-out state. The epoch now advances synchronously at sign-out intent and stays advanced if the call fails.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuthProvider } from '../AuthProvider';
import * as supabaseClient from '../../lib/supabaseClient';
import { authEpoch, currentOwnerId, setCurrentLogin } from '@/services/loginSessionLog';

vi.mock('../../lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('../../utils/fetchWithRetry', () => ({ fetchWithRetry: vi.fn((fn: () => unknown) => fn()) }));
vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), get_distinct_id: vi.fn(() => 'anon'), __loaded: true },
}));

// A signed-in user whose session carries NO last_sign_in_at (the case the reviewer named).
const SESSION = { access_token: 't', user: { id: 'owner-a', email: 'a@example.com' } };

let signOutFn: () => Promise<void> = async () => undefined;
const Grab: React.FC = () => { signOutFn = useAuthProvider().signOut; return null; };

let mockSignOut: Mock;
let emitAuth: (event: string, session: unknown) => void = () => undefined;
beforeEach(() => {
    setCurrentLogin(null, null);
    mockSignOut = vi.fn();
    vi.mocked(supabaseClient.getSupabaseClient).mockReturnValue({
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
            onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
                emitAuth = cb;
                return { data: { subscription: { unsubscribe: vi.fn() } } };
            }),
            signOut: mockSignOut,
        },
        from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })),
    } as unknown as ReturnType<typeof supabaseClient.getSupabaseClient>);
});

const renderSignedIn = async () => {
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
    act(() => emitAuth('SIGNED_IN', SESSION));   // Supabase applies the identity through an auth event
    await waitFor(() => expect(currentOwnerId()).toBe('owner-a'));
    return authEpoch();
};

describe('#1573 Codex P1 4223862191 — sign-out intent advances the auth epoch synchronously', () => {
    it('CASUALTY: a slow sign-out (no SIGNED_OUT event yet) already invalidates the epoch and owner', async () => {
        mockSignOut.mockReturnValue(new Promise(() => { /* the request never answers */ }));
        const before = await renderSignedIn();
        act(() => { void signOutFn(); });
        expect(currentOwnerId()).toBeNull();
        expect(authEpoch()).not.toBe(before);
    });

    it('CASUALTY: a REJECTED sign-out keeps the invalidation', async () => {
        mockSignOut.mockRejectedValue(new Error('network'));
        const before = await renderSignedIn();
        await act(async () => { await signOutFn(); });
        expect(currentOwnerId()).toBeNull();
        expect(authEpoch()).not.toBe(before);
    });

    it('CONTROL: a same-login TOKEN_REFRESHED keeps the epoch, so a genuine download is not cancelled', async () => {
        const signedIn = { ...SESSION, user: { ...SESSION.user, last_sign_in_at: '2026-10-08T12:00:00Z' } };
        render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Grab /></AuthProvider></QueryClientProvider>);
        act(() => emitAuth('SIGNED_IN', signedIn));
        await waitFor(() => expect(currentOwnerId()).toBe('owner-a'));
        const before = authEpoch();
        act(() => emitAuth('TOKEN_REFRESHED', { ...signedIn, access_token: 't2' }));
        expect(currentOwnerId()).toBe('owner-a');
        expect(authEpoch()).toBe(before);
    });
});
