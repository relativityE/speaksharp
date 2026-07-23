import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SignInPage from '../SignInPage';
import AuthPage from '../AuthPage';
import * as AuthProvider from '@/contexts/AuthProvider';

// Both auth pages delegate the post-auth destination to <PostAuthRedirect>, which is flag-free: a safe
// deep-link wins, otherwise → /practice. No PostHog is consulted. This suite proves that composition at the
// page level (already-authenticated / just-completed-auth → the resolved destination).
vi.mock('@/contexts/AuthProvider');
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: () => ({ auth: {} }) }));

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
