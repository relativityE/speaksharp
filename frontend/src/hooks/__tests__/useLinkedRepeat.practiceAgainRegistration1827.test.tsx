/**
 * #1827 D2 rev 4 — the contrast through the client's actual Practice again → Start path: the real `useLinkedRepeat.accept`
 * stores this tab's intent, and the real `saveSession` (the Start that creates the take) registers that take with the
 * attempt. The same create in another tab (no intent there; the owner-wide handoff is shared) registers nothing, so the
 * server gives that take neither the repeat link nor the tip (proved on the shipped save path in
 * tests/db/repeat-practised-tip-real-save.integration.test.ts).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLinkedRepeat } from '../useLinkedRepeat';
import { saveSession } from '@/lib/storage';
import { clearOpenAttempt, getOpenAttemptForUser } from '@/services/progress/openAttempt';
import { clearPracticeAgainIntent, getPracticeAgainIntent } from '@/services/progress/practiceAgainIntent';

const USER = 'user-1827';
const rpc = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ rpc }) }));
vi.mock('@/contexts/AuthProvider', () => ({ useAuthProvider: () => ({ user: { id: USER }, signedOutByUser: false }) }));
vi.mock('@/services/progress/loadSessionProgress', () => ({
    loadSessionProgress: async () => ({ status: 'eligible', recommendationId: 'rec-1', latestAttempt: null }),
}));
const readPending = vi.fn(async () => ({ status: 'none' } as { status: string; attemptId?: string }));
vi.mock('@/services/progress/recordProgress', () => ({
    readPendingRecommendationAttempt: () => readPending(),
    recordRecommendationAttempt: async () => 'attempt-1',
    abandonRecommendationAttempt: async () => true,
}));
vi.mock('@/services/reviewSurfaceTelemetry', () => ({ trackSavedReviewLinkedAttempt: vi.fn() }));

const created = (id: string) => ({ data: { new_session: { id } }, error: null });
const registerCalls = () => rpc.mock.calls.filter((c) => c[0] === 'register_practice_again_take_v1').map((c) => c[1]);
/** Registrations of a take (the press's declaration carries no session). */
const registrations = () => registerCalls().filter((args) => args.p_session !== null);

/** The server's registration: the first take registers; while one is registered, any other take is refused. */
let registered: string | null = null;
let nextTake = 'take-b';
beforeEach(() => {
    rpc.mockReset();
    registered = null;
    nextTake = 'take-b';
    rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
        if (name !== 'register_practice_again_take_v1') return created(nextTake);
        if (args.p_session === null) return { data: true, error: null };   // the press's declaration
        if (registered === null) registered = args.p_session;
        return { data: registered === args.p_session, error: null };
    });
});
afterEach(() => { clearPracticeAgainIntent(); clearOpenAttempt(); });

async function pressPracticeAgain() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLinkedRepeat('session-a'), { wrapper });
    await waitFor(() => expect(result.current.linkState).toBe('linked'));
    const afterLinked = vi.fn();
    await act(async () => { await result.current.accept(afterLinked); });
    expect(afterLinked).toHaveBeenCalledOnce();
    expect(getOpenAttemptForUser(USER)?.attemptId).toBe('attempt-1');
    // The press declared, once, that this attempt's repeat will be registered.
    expect(registerCalls().filter((args) => args.p_session === null)).toContainEqual({ p_attempt: 'attempt-1', p_session: null });
}

describe('#1827 Practice again → Start registers only this tab\'s take', () => {
    it('this tab: the take created after the click is registered; later Starts in this tab ask the server, which decides', async () => {
        await pressPracticeAgain();
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(registrations()).toEqual([{ p_attempt: 'attempt-1', p_session: 'take-b' }]);
        nextTake = 'take-d';
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(registered).toBe('take-b');                    // the server refused take-d: take-b stays the repeat
        expect(getOpenAttemptForUser(USER)).not.toHaveProperty('registeredSessionId');
    });

    it('another tab: the same owner-wide handoff, but no intent in that tab, so its take is never registered', async () => {
        await pressPracticeAgain();
        sessionStorage.clear();                       // a different tab has its own, empty sessionStorage
        expect(getOpenAttemptForUser(USER)?.attemptId).toBe('attempt-1');
        expect((await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never)).status).toBe('saved');
        expect(registrations()).toEqual([]);
    });

    it('a discarded repeat (released by the server) is replaced by the next take from this tab, with no client state to clear', async () => {
        await pressPracticeAgain();
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        registered = null;                            // take-b ended 'failed': the server released its registration
        nextTake = 'take-e';
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        expect(registered).toBe('take-e');
    });

    it('reusing the pending attempt writes a fresh handoff and intent; the repeat identity stays on the server', async () => {
        await pressPracticeAgain();
        await saveSession({ user_id: USER, duration: 0 } as never, 'private' as never);
        readPending.mockResolvedValueOnce({ status: 'one', attemptId: 'attempt-1' });
        await pressPracticeAgain();
        expect(getOpenAttemptForUser(USER)).toMatchObject({ attemptId: 'attempt-1', registrationRequired: true });
        expect(getPracticeAgainIntent(USER)).toEqual({ attemptId: 'attempt-1', userId: USER });
        expect(registered).toBe('take-b');
    });

    it('a database before the migration (no registration function at the press) makes an ordinary attempt: today\'s rules', async () => {
        rpc.mockImplementation(async (name: string, args: Record<string, string>) => (name === 'register_practice_again_take_v1' && args.p_session === null
            ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : created(nextTake)));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => useLinkedRepeat('session-a'), { wrapper });
        await waitFor(() => expect(result.current.linkState).toBe('linked'));
        await act(async () => { await result.current.accept(vi.fn()); });
        expect(getOpenAttemptForUser(USER)).toMatchObject({ attemptId: 'attempt-1' });
        expect(getOpenAttemptForUser(USER)).not.toHaveProperty('registrationRequired');
    });
});

