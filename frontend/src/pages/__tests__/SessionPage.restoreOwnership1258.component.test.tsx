/**
 * #1258 PR 4 (Browser PM 6050746477) — the restored session is shown only to its owner.
 *
 * `/session?review=<id>` restores the saved row read-only. A row can reach the page from the query cache of an earlier
 * account, so the id alone is not ownership: a row whose `user_id` is not the signed-in user must never render — no
 * restored cards, no transcript, no metrics — and the page falls back to plain `/session`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import SessionPage from '../SessionPage';
import { useSessionStore } from '@/stores/useSessionStore';
import * as SessionLifecycleHook from '@/hooks/useSessionLifecycle';
import * as RecoveryHook from '@/hooks/useUnresolvedRecovery';
import { getSupabaseClient } from '@/lib/supabaseClient';

vi.mock('@/hooks/useSessionLifecycle', () => ({ useSessionLifecycle: vi.fn() }));
vi.mock('@/hooks/useUnresolvedRecovery', () => ({ useUnresolvedRecovery: vi.fn() }));
vi.mock('@/lib/supabaseClient');
vi.mock('@/lib/storage', async (orig) => {
    const actual = await orig<typeof import('@/lib/storage')>();
    return { ...actual, getSessionById: (...args: unknown[]) => getSessionById(...args) };
});
vi.mock('@/components/session/StatusNotificationBar', () => ({ StatusNotificationBar: () => <div /> }));
vi.mock('@/components/session/MobileActionBar', () => ({ MobileActionBar: () => <div data-testid="mobile-action-bar" /> }));
vi.mock('@/components/analytics/SavedPracticeLoopReview', () => ({
    SavedPracticeLoopReview: ({ sessionId }: { sessionId: string }) => <section data-testid="saved-review" data-session={sessionId} />,
}));
vi.mock('@/components/analytics/SavedFocusPointsCoverage', () => ({ SavedFocusPointsCoverage: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), id: vi.fn() } }));
vi.mock('@/contexts/AuthProvider', async (orig) => {
    const actual = await orig<typeof import('@/contexts/AuthProvider')>();
    const user = { id: 'owner-1' };
    return { ...actual, useAuthProvider: () => ({ session: { user }, user }) };
});

// The harness's `route` string becomes a pathname, so a query string is passed as `{ pathname, search }`.
const { getSessionById } = vi.hoisted(() => ({ getSessionById: vi.fn() }));
const REVIEW_ID = 'session-a1';
const row = (userId: string) => ({
    id: REVIEW_ID, user_id: userId, transcript: 'Account A private words', transcript_state: 'available',
    total_words: 4, duration: 42, wpm: 120, filler_counts: { um: 1 }, created_at: new Date().toISOString(), status: 'completed',
});

const lifecycle = () => ({
    isListening: false, isReady: true,
    metrics: { formattedTime: '00:00', wpm: 0, wpmLabel: '', clarityScore: 0, clarityLabel: '', fillerCount: 0, fillerData: {} },
    sttStatus: { type: 'ready' as const, message: 'Ready' }, modelLoadingProgress: null, privateModelStatus: 'ready',
    mode: 'private' as const, setMode: vi.fn(), elapsedTime: 0, handleStartStop: vi.fn(),
    // A re-entered page: the live after state is gone (the lifecycle flag reset on remount).
    showAnalyticsPrompt: false, setShowAnalyticsPrompt: vi.fn(), settleReviewLatency: vi.fn(),
    sessionFeedbackMessage: null, micLevel: 0, transcriptContent: '', interimTranscript: '',
    canUsePrivateStt: true, isButtonDisabled: false, sunsetModal: { type: 'daily', open: false },
});

beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().resetSession();
    vi.mocked(SessionLifecycleHook.useSessionLifecycle).mockReturnValue(lifecycle() as unknown as ReturnType<typeof SessionLifecycleHook.useSessionLifecycle>);
    vi.mocked(RecoveryHook.useUnresolvedRecovery).mockReturnValue({
        recoveryDraft: null, acknowledgeRecoveryDraft: vi.fn(), dismissRecoveryDraft: vi.fn(),
    } as unknown as ReturnType<typeof RecoveryHook.useUnresolvedRecovery>);
    vi.mocked(getSupabaseClient).mockReturnValue({ functions: { invoke: vi.fn() } } as unknown as ReturnType<typeof getSupabaseClient>);
});

describe('#1258 PR 4 — the restored session is shown only to its owner', () => {
    it('POSITIVE CONTROL: the signed-in owner\'s saved row is restored read-only', async () => {
        getSessionById.mockResolvedValue(row('owner-1'));
        render(<SessionPage />, { route: { pathname: '/session', search: `?review=${REVIEW_ID}` } });
        expect(await screen.findByTestId('saved-session-return')).toHaveAttribute('data-session-id', REVIEW_ID);
        expect(screen.getByText('Account A private words')).toBeInTheDocument();
        expect(screen.queryByTestId('mobile-action-bar')).toBeNull();
    });

    it('CASUALTY: another account\'s row with the same id renders NOTHING from it, and the page falls back', async () => {
        getSessionById.mockResolvedValue(row('account-a'));
        render(<SessionPage />, { route: { pathname: '/session', search: `?review=${REVIEW_ID}` } });
        await waitFor(() => expect(getSessionById).toHaveBeenCalledWith(REVIEW_ID));
        // The fallback drops the parameter: the restore placeholder goes away and the ordinary page (with its Start bar) returns.
        await waitFor(() => expect(screen.queryByTestId('saved-session-return-loading')).toBeNull());
        expect(await screen.findByTestId('mobile-action-bar')).toBeInTheDocument();
        expect(screen.queryByTestId('saved-session-return')).toBeNull();
        expect(screen.queryByText('Account A private words')).toBeNull();
        expect(screen.queryByTestId('this-run-card')).toBeNull();
    });

    it.each([
        ['not found (RLS returns no row)', () => getSessionById.mockResolvedValue(null)],
        ['a failed read', () => getSessionById.mockRejectedValue(new Error('Unable to load this session.'))],
    ])('%s falls back to the plain page with no restored cards', async (_label, arrange) => {
        arrange();
        render(<SessionPage />, { route: { pathname: '/session', search: `?review=${REVIEW_ID}` } });
        expect(await screen.findByTestId('mobile-action-bar')).toBeInTheDocument();
        expect(screen.queryByTestId('saved-session-return')).toBeNull();
    });

    it('a malformed id is dropped without any read', async () => {
        render(<SessionPage />, { route: { pathname: '/session', search: '?review=not%20an%20id%3B' } });
        expect(await screen.findByTestId('mobile-action-bar')).toBeInTheDocument();
        expect(getSessionById).not.toHaveBeenCalled();
    });
});

describe('#1573 Codex P1 4222489737 — a restored session is revalidated, never shown from a stale cache', () => {
    it('CASUALTY: a cached detail row still holding transcript text is NOT rendered once the server has expired it', async () => {
        // The detail row was read earlier (e.g. the Analytics detail) and is still "fresh" for the 5-minute staleTime.
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        qc.setQueryData(['session', REVIEW_ID], { ...row('owner-1'), transcript: 'Account A private words', transcript_state: 'available' });
        // Meanwhile a newer take aged this session's transcript out (newest-one retention): the server row is expired.
        let resolveRead: (v: unknown) => void = () => {};
        getSessionById.mockReturnValue(new Promise((r) => { resolveRead = r; }));
        render(<SessionPage />, {
            route: { pathname: '/session', search: `?review=${REVIEW_ID}` },
            wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
        });
        // Before the fresh read answers: a placeholder, never the cached text.
        expect(await screen.findByTestId('saved-session-return-loading')).toBeInTheDocument();
        expect(screen.queryByText('Account A private words')).toBeNull();
        expect(getSessionById).toHaveBeenCalledWith(REVIEW_ID); // the restore asks the server, cache or not
        resolveRead({ ...row('owner-1'), transcript: null, transcript_state: 'expired' });
        expect(await screen.findByTestId('saved-session-return')).toHaveAttribute('data-session-id', REVIEW_ID);
        expect(screen.queryByText('Account A private words')).toBeNull();
    });
});
