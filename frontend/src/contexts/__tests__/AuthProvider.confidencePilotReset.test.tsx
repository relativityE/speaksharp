/**
 * Confidence check pilot (Codex P2 on #1994): the session-only answers are cleared at the AUTHENTICATION boundary — an
 * explicit sign-out, a SIGNED_OUT event and any change of signed-in owner — not only by an effect on the session page,
 * which is not mounted when the user signs out from Progress or History.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuthProvider } from '../AuthProvider';
import * as supabaseClient from '../../lib/supabaseClient';
import { currentOwnerId, setCurrentLogin } from '@/services/loginSessionLog';
import { clearConfidencePilot, confidencePilotSnapshot, startLoop, answerPre } from '@/services/confidenceCheck/pilotState';

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
};

const answered = () => { startLoop('owner-a'); answerPre('owner-a', 4); expect(confidencePilotSnapshot()).toMatchObject({ pre: 4 }); };

describe('confidence pilot answers are cleared at the auth boundary', () => {
    beforeEach(() => { clearConfidencePilot(); });

    it('an explicit sign-out (from any page) clears the answers at once', async () => {
        mockSignOut.mockReturnValue(new Promise(() => { /* never answers */ }));
        await renderSignedIn();
        answered();
        act(() => { void signOutFn(); });
        expect(confidencePilotSnapshot()).toBeNull();
    });

    it('a SIGNED_OUT event (revoked session, failed refresh) clears the answers', async () => {
        await renderSignedIn();
        answered();
        act(() => emitAuth('SIGNED_OUT', null));
        expect(confidencePilotSnapshot()).toBeNull();
    });

    it('a change of signed-in owner clears the answers', async () => {
        await renderSignedIn();
        answered();
        act(() => emitAuth('SIGNED_IN', { access_token: 'u', user: { id: 'owner-b', email: 'b@example.com' } }));
        expect(confidencePilotSnapshot()).toBeNull();
    });

    it('CONTROL: a same-owner token refresh keeps the answers', async () => {
        await renderSignedIn();
        answered();
        act(() => emitAuth('TOKEN_REFRESHED', { ...SESSION, access_token: 't2' }));
        expect(confidencePilotSnapshot()).toMatchObject({ pre: 4 });
        expect(currentOwnerId()).toBe('owner-a');
    });
});
