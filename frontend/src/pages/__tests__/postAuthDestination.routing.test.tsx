import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import SignInPage from '../SignInPage';
import AuthPage from '../AuthPage';
import { AuthIndexRedirect } from '@/components/AuthIndexRedirect';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ENV } from '@/config/TestFlags';
import * as AuthProvider from '@/contexts/AuthProvider';
import { LegacyProgressRedirect } from '@/App';

// Both auth pages delegate the post-auth destination to <PostAuthRedirect>, which is flag-free: a safe
// deep-link wins, otherwise → /practice. No PostHog is consulted. This suite proves that composition at the
// page level (already-authenticated / just-completed-auth → the resolved destination).
vi.mock('@/contexts/AuthProvider');
const signInWithOtp = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ auth: { signInWithOtp } }) }));

const mockUseAuthProvider = vi.mocked(AuthProvider.useAuthProvider);
const authed = () => ({
  session: { user: { id: 'u1' } }, user: { id: 'u1' }, loading: false, setSession: vi.fn(), signOut: vi.fn(),
} as unknown as ReturnType<typeof AuthProvider.useAuthProvider>);

function renderPage(Page: React.ComponentType, state?: { from?: { pathname?: string } }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: Page === SignInPage ? '/auth/signin' : '/auth/signup', state }]}>
      <Routes>
        <Route path="/auth/signin" element={<Page />} />
        <Route path="/auth/signup" element={<Page />} />
        <Route path="/practice" element={<div data-testid="practice">PRACTICE</div>} />
        <Route path="/session" element={<div data-testid="session">SESSION</div>} />
        <Route path="/analytics/:id" element={<div data-testid="analytics">ANALYTICS</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('post-auth destination — /practice is the flag-free default (SignInPage)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockUseAuthProvider.mockReturnValue(authed()); });

  it('already-authenticated sign-in, no deep-link → /practice', () => {
    renderPage(SignInPage);
    expect(screen.getByTestId('practice')).toBeInTheDocument();
  });
  it('a valid protected deep-link (/session bookmark) is preserved', () => {
    renderPage(SignInPage, { from: { pathname: '/session' } });
    expect(screen.getByTestId('session')).toBeInTheDocument();
  });
  it('an unsafe/external return path is rejected → /practice', () => {
    renderPage(SignInPage, { from: { pathname: '//evil.com' } });
    expect(screen.getByTestId('practice')).toBeInTheDocument();
  });
});

describe('deep-link survives the REAL /auth hop (regression: ProtectedRoute → /auth → /auth/signin)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockUseAuthProvider.mockReturnValue(authed()); });

  // Reproduces the real unauthenticated-deep-link flow: ProtectedRoute sends the user to /auth with
  // state.from; the /auth index-redirect must FORWARD that state to /auth/signin (a plain <Navigate> would
  // drop it), so SignInPage still sees from=/session and lands there — not the /practice default.
  it('a /session bookmark opened signed-out lands back on /session after sign-in (state not dropped)', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/auth', state: { from: { pathname: '/session' } } }]}>
        <Routes>
          <Route path="/auth" element={<AuthIndexRedirect to="/auth/signin" />} />
          <Route path="/auth/signin" element={<SignInPage />} />
          <Route path="/practice" element={<div data-testid="practice">PRACTICE</div>} />
          <Route path="/session" element={<div data-testid="session">SESSION</div>} />
        </Routes>
      </MemoryRouter>,
    );
    // /auth → (state forwarded) → /auth/signin → SignInPage(authed) → PostAuthRedirect(from=/session) → /session.
    expect(screen.getByTestId('session')).toBeInTheDocument();
    expect(screen.queryByTestId('practice')).not.toBeInTheDocument();
  });

  it('with no protected deep-link, the /auth hop still resolves to the /practice default', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/auth' }]}>
        <Routes>
          <Route path="/auth" element={<AuthIndexRedirect to="/auth/signin" />} />
          <Route path="/auth/signin" element={<SignInPage />} />
          <Route path="/practice" element={<div data-testid="practice">PRACTICE</div>} />
          <Route path="/session" element={<div data-testid="session">SESSION</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('practice')).toBeInTheDocument();
  });
});

describe('post-auth destination — /practice is the flag-free default (AuthPage / signup)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockUseAuthProvider.mockReturnValue(authed()); });

  it('completed signup / already-authenticated, no deep-link → /practice', () => {
    renderPage(AuthPage);
    expect(screen.getByTestId('practice')).toBeInTheDocument();
  });
  it('a valid protected deep-link is preserved through signup', () => {
    renderPage(AuthPage, { from: { pathname: '/analytics/xyz' } });
    expect(screen.getByTestId('analytics')).toBeInTheDocument();
  });
});

// #1548 — the LOGGED-OUT round trip, composed from the real consumers: ProtectedRoute → /auth → AuthIndexRedirect →
// SignInPage → PostAuthRedirect. The E2E auth bypass is OFF (asserted), and auth flips from signed-out to signed-in
// mid-flow through a store, exactly as a completed sign-in re-renders the page. A data router exposes the history.
describe('#1548 logged-out deep link → sign-in → the exact destination (consumer composition, no E2E bypass)', () => {
  const ID = '7e7aca2c-c192-4a80-8976-df5637859164';
  const signedOut = () => ({
    session: null, user: null, loading: false, signedOutByUser: false, setSession: vi.fn(), signOut: vi.fn(),
  } as unknown as ReturnType<typeof AuthProvider.useAuthProvider>);
  let current = signedOut();
  const listeners = new Set<() => void>();
  const authStore = {
    get: () => current,
    set: (next: ReturnType<typeof AuthProvider.useAuthProvider>) => { current = next; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };

  function Destination() {
    const location = useLocation();
    return <div data-testid="destination" data-location={`${location.pathname}${location.search}${location.hash}`}
      data-state={JSON.stringify(location.state ?? null)} />;
  }

  type Entry = { pathname: string; search?: string; hash?: string; state?: unknown };
  function startAt(entry: Entry) {
    const router = createMemoryRouter([
      { path: '/progress/:sessionId', element: <ProtectedRoute><Destination /></ProtectedRoute> },
      { path: '/analytics/:sessionId', element: <ProtectedRoute><Destination /></ProtectedRoute> },
      { path: '/auth', element: <AuthIndexRedirect to="/auth/signin" /> },
      { path: '/auth/signin', element: <SignInPage /> },
      { path: '/practice', element: <div data-testid="practice" /> },
    ], { initialEntries: ['/practice', entry], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    return router;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    current = signedOut();
    listeners.clear();
    mockUseAuthProvider.mockImplementation(() => React.useSyncExternalStore(authStore.subscribe, authStore.get));
  });

  for (const base of ['/progress', '/analytics']) {
    it(`${base}/<id>?q#hash with router state: signed out → sign-in → back to the same path, query, hash and state (replace)`, async () => {
      expect(ENV.isE2E).toBe(false); // ProtectedRoute's unauthenticated branch really runs
      const router = startAt({ pathname: `${base}/${ID}`, search: '?q=1', hash: '#trend', state: { tab: 'filler' } });

      // Signed out: the protected route sent us to sign-in, carrying the destination; nothing protected rendered.
      expect(await screen.findByTestId('email-input')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/auth/signin');
      expect(screen.queryByTestId('destination')).toBeNull();

      act(() => authStore.set(authed())); // sign-in completes

      const landed = await screen.findByTestId('destination');
      expect(landed).toHaveAttribute('data-location', `${base}/${ID}?q=1#trend`);
      expect(landed).toHaveAttribute('data-state', JSON.stringify({ tab: 'filler' }));
      expect(router.state.historyAction).toBe('REPLACE');
      // Every hop replaced: Back leaves for the page before the deep link, never the sign-in screen.
      await act(async () => { await router.navigate(-1); });
      expect(router.state.location.pathname).toBe('/practice');
    });
  }

  // #1548 composed with #1700: the REAL legacy alias redirect runs before the protected canonical route, so a signed-out
  // /analytics link (any casing) is canonicalized first and the sign-in round trip ends on /progress, never /analytics.
  function startAtLegacy(entry: Entry) {
    const router = createMemoryRouter([
      { path: '/progress/:sessionId', element: <ProtectedRoute><Destination /></ProtectedRoute> },
      { path: '/analytics/:sessionId', element: <LegacyProgressRedirect /> },
      { path: '/auth', element: <AuthIndexRedirect to="/auth/signin" /> },
      { path: '/auth/signin', element: <SignInPage /> },
      { path: '/practice', element: <div data-testid="practice" /> },
    ], { initialEntries: ['/practice', entry], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    return router;
  }

  // Sam RETURN 1792964160.252279: the router matches segments decoded, so an encoded alias reaches this redirect too.
  for (const legacy of ['/analytics', '/Analytics', '/%61nalytics', '/%41NALYTICS']) {
    it(`legacy ${legacy}/<id>?q#hash signed out → canonical /progress → sign-in → /progress/<id>?q#hash with state (replace)`, async () => {
      expect(ENV.isE2E).toBe(false);
      const router = startAtLegacy({ pathname: `${legacy}/${ID}`, search: '?q=1', hash: '#trend', state: { tab: 'filler' } });
      expect(await screen.findByTestId('email-input')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/auth/signin');
      act(() => authStore.set(authed()));
      const landed = await screen.findByTestId('destination');
      expect(landed).toHaveAttribute('data-location', `/progress/${ID}?q=1#trend`);
      expect(landed).toHaveAttribute('data-state', JSON.stringify({ tab: 'filler' }));
      await act(async () => { await router.navigate(-1); });
      expect(router.state.location.pathname).toBe('/practice');
    });
  }

  it('a sign-in surface as the destination (auth loop) lands on /practice with no state', async () => {
    const router = startAt({ pathname: '/auth', state: { from: { pathname: '/auth/signin', hash: '#x', state: { leak: 1 } } } });
    expect(await screen.findByTestId('email-input')).toBeInTheDocument();
    act(() => authStore.set(authed()));
    expect(await screen.findByTestId('practice')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/practice');
    expect(router.state.location.state ?? null).toBeNull();
  });

  it('the magic-link email keeps its existing contract: pathname + query only, no fragment or state, shouldCreateUser:false', async () => {
    startAt({ pathname: `/progress/${ID}`, search: '?q=1', hash: '#trend', state: { tab: 'filler' } });
    fireEvent.change(await screen.findByTestId('email-input'), { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByTestId('magic-link-button'));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/progress/${ID}?q=1` },
    });
    expect(JSON.stringify(signInWithOtp.mock.calls[0])).not.toMatch(/#|trend|filler/);
  });
});
