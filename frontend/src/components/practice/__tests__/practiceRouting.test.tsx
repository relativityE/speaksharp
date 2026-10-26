import { describe, it, expect, vi, beforeEach } from 'vitest';
// Raw RTL render: this suite controls its OWN MemoryRouter. useAuthProvider is mocked, so no real
// AuthContext provider is needed.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { PostAuthRedirect, PostAuthContinue } from '../practiceRouting';
import { useAuthProvider } from '@/contexts/AuthProvider';

// Keep the real module (shared test-utils imports AuthContext from it) — override only the hook.
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return { ...actual, useAuthProvider: vi.fn() };
});

const mockedAuth = vi.mocked(useAuthProvider);
const asAuth = (id: string | null, loading: boolean) => ({ user: id ? { id } : null, loading } as ReturnType<typeof useAuthProvider>);

/** Renders where it landed: full path (with search + hash) and the router state it received. */
function Landed({ testId, label }: { testId: string; label: string }) {
  const location = useLocation();
  return <div data-testid={testId} data-location={`${location.pathname}${location.search}${location.hash}`}
    data-state={JSON.stringify(location.state ?? null)}>{label}</div>;
}

function renderAt(initial: string, entryElement?: React.ReactNode, withLocation = false) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <main id="main-content">
        <Routes>
          {entryElement ? <Route path={initial} element={entryElement} /> : null}
          <Route path="/practice" element={withLocation ? <Landed testId="practice-marker" label="PRACTICE" /> : <div data-testid="practice-marker">PRACTICE</div>} />
          <Route path="/session" element={withLocation ? <Landed testId="session-page" label="SESSION" /> : <div data-testid="session-page">SESSION</div>} />
          <Route path="/auth/signin" element={<div data-testid="signin-page">SIGNIN</div>} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}

describe('PostAuthRedirect — /practice is the flag-free default', () => {
  beforeEach(() => mockedAuth.mockReset());

  it('no deep-link → /practice', () => {
    renderAt('/auth', <PostAuthRedirect from={null} />);
    expect(screen.getByTestId('practice-marker')).toBeInTheDocument();
  });
  it('safe deep-link wins (e.g. a /session bookmark)', () => {
    renderAt('/auth', <PostAuthRedirect from={{ pathname: '/session' }} />);
    expect(screen.getByTestId('session-page')).toBeInTheDocument();
  });
  it('unsafe/external return path is rejected → /practice', () => {
    renderAt('/auth', <PostAuthRedirect from={{ pathname: '//evil.com' }} />);
    expect(screen.getByTestId('practice-marker')).toBeInTheDocument();
  });  it('#1548: an unsafe destination never carries the wrapper state to /practice', () => {
    renderAt('/auth', <PostAuthRedirect from={{ pathname: '//evil.com', state: { leak: 1 } }} />, true);
    expect(screen.getByTestId('practice-marker')).toHaveAttribute('data-state', 'null');
  });
  it('#1548: a safe deep-link lands with its hash and original router state', () => {
    renderAt('/auth', <PostAuthRedirect from={{ pathname: '/session', search: '?q=1', hash: '#top', state: { from: 'saved-review' } }} />, true);
    const page = screen.getByTestId('session-page');
    expect(page).toHaveAttribute('data-location', '/session?q=1#top');
    expect(page).toHaveAttribute('data-state', JSON.stringify({ from: 'saved-review' }));
  });
});

describe('PostAuthContinue — magic-link continuation → /practice (after session recovery)', () => {
  beforeEach(() => mockedAuth.mockReset());

  it('WAITS for the recovering session (loading) — shows a loader, navigates nowhere', () => {
    mockedAuth.mockReturnValue(asAuth(null, true));
    renderAt('/auth/continue', <PostAuthContinue />);
    expect(screen.getByTestId('practice-gate-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('signin-page')).not.toBeInTheDocument();
  });
  it('after the session resolves (no deep-link) → /practice', () => {
    mockedAuth.mockReturnValue(asAuth('u1', false));
    renderAt('/auth/continue', <PostAuthContinue />);
    expect(screen.getByTestId('practice-marker')).toBeInTheDocument();
  });
  it('no recovered session → sign-in (no loop back to /auth/continue)', () => {
    mockedAuth.mockReturnValue(asAuth(null, false));
    renderAt('/auth/continue', <PostAuthContinue />);
    expect(screen.getByTestId('signin-page')).toBeInTheDocument();
  });
});
