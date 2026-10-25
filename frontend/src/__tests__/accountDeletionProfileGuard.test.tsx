import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext, type AuthContextType } from '@/contexts/AuthProvider';
import { completionCapabilities } from '@/services/accountCompletionStatus';
import App from '../App';

/**
 * #1643 (Sam RETURN 1792912453): the deletion page through the REAL App and the REAL ProfileGuard production path
 * (ProfileGuard is not mocked and E2E mock mode is off). Losing Auth swaps ProfileGuard's wrapper, and under it that
 * remounted the page and dropped the retained owner/request, hiding capability-only status recovery.
 */
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), getSession: vi.fn(),
  profile: { data: { id: 'owner' } as unknown, isLoading: false, error: null as Error | null, refetch: vi.fn() },
}));

vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({
  auth: { getSession: mocks.getSession }, functions: { invoke: mocks.invoke },
}) }));
vi.mock('@/services/accountDeletionVerification', () => ({
  accountDeletionToken: () => null,
  consumeAccountDeletionToken: () => false,
}));
vi.mock('../hooks/useUserProfile', () => ({ useUserProfile: () => mocks.profile }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mocks.profile }));
vi.mock('../components/Navigation', () => ({ default: () => <nav data-testid="navigation" /> }));
vi.mock('../components/ui/PageTransition', () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/hooks/useCheckoutNotifications', () => ({ useCheckoutNotifications: vi.fn() }));
vi.mock('../hooks/useCriticalQueries', () => ({ useCriticalQueries: () => ({ isResolved: true }) }));
vi.mock('../providers/TranscriptionProvider', () => ({
  TranscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// One STABLE component per tag, like real framer-motion. A fresh component on every property read would make each App
// re-render (an Auth change re-renders App) remount the routed page, faking exactly the remount this file tests for.
vi.mock('framer-motion', () => {
  const cache = new Map<PropertyKey, React.FC<{ children?: React.ReactNode } & Record<string, unknown>>>();
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_target, tag) => {
        if (!cache.has(tag)) {
          cache.set(tag, ({ children, initial: _i, animate: _a, transition: _t, ...rest }) => (
            <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
          ));
        }
        return cache.get(tag);
      },
    }),
  };
});

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = 'c'.repeat(64);
const pending = { outcome: 'pending', requestId, phase: 'pending', destructiveEnabled: false, checkoutPending: 1 };
const processing = { outcome: 'processing', requestId, canRetry: false };
const completed = { outcome: 'completed', requestId, accountDeleted: true, canRetry: false };
const reads: Array<{ action: string; authorization: string | null }> = [];
let readReply: unknown = processing;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const user = { id: 'owner' } as User;
const session = { user, access_token: 'test-bearer-owner' } as Session;
let setAuth: (next: { session: Session | null; user: User | null }) => void = () => {};

const Harness = () => {
  const [auth, set] = React.useState<{ session: Session | null; user: User | null }>({ session, user });
  setAuth = set;
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const value = { ...auth, loading: false, signOut: vi.fn(), setSession: vi.fn() } as unknown as AuthContextType;
  return (
    <MemoryRouter initialEntries={['/account/delete']}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={value}><App /></AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  reads.length = 0;
  readReply = processing;
  completionCapabilities.clear();
  mocks.profile = { data: { id: 'owner' }, isLoading: false, error: null, refetch: vi.fn() };
  mocks.getSession.mockImplementation(async () => ({ data: { session }, error: null }));
  mocks.invoke.mockResolvedValue({ data: pending, error: null });
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { action: string; requestId: string };
    const headers = (init?.headers ?? {}) as Record<string, string>;
    reads.push({ action: body.action, authorization: headers.Authorization ?? null });
    if (body.action === 'completion_status_issue') return json({ outcome: 'status_capability', requestId, token: key, expiresAt: Date.now() + 900_000 });
    if (body.action === 'completion_status_ack') return json({ outcome: 'status_acknowledged', requestId });
    return json(readReply);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const notice = () => screen.queryByTestId('account-completion-status');

describe('#1643 deletion page on the real App + ProfileGuard path', () => {
  it('an acknowledged pending deletion keeps capability-only status recovery after Auth is lost (no new request or confirm)', async () => {
    render(<Harness />);
    await waitFor(() => expect(notice()).toHaveTextContent('Your account is being deleted.'));

    // Real Auth loss: the client and the context both lose the session; ProfileGuard would switch to its signed-out wrapper.
    mocks.getSession.mockImplementation(async () => ({ data: { session: null }, error: null }));
    act(() => setAuth({ session: null, user: null }));

    readReply = completed;
    fireEvent.click(await screen.findByRole('button', { name: 'Check deletion status' }));
    await waitFor(() => expect(notice()).toHaveTextContent(/^Your account has been deleted\.$/));
    expect(reads[reads.length - 1]).toEqual({ action: 'completion_status_read', authorization: null });
    expect(mocks.invoke.mock.calls.every(([, options]) => options.body.action === 'status')).toBe(true);
  });

  it('a failed profile fetch does not replace the deletion page with the global profile error screen', async () => {
    mocks.profile = { data: null, isLoading: false, error: new Error('profile unavailable'), refetch: vi.fn() };
    render(<Harness />);
    expect(await screen.findByTestId('account-deletion-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-error')).not.toBeInTheDocument();
  });
});
