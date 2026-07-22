import { describe, it, expect, vi, beforeEach } from 'vitest';
// Raw RTL render: this suite controls its OWN MemoryRouter (the shared test-utils render injects one,
// which would nest routers). useAuthProvider is mocked, so no real AuthContext provider is needed.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PracticeEntryGate, PostAuthRedirect } from '../practiceRouting';
import PracticePage from '@/pages/PracticePage';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { resolveAuthedFlag, resolveAuthedDefaultPath } from '@/services/practiceEntryFlags';

// Keep the real module (shared test-utils imports AuthContext from it) — override only the hook.
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return { ...actual, useAuthProvider: vi.fn() };
});
vi.mock('@/config/TestFlags', () => ({ ENV: { isE2E: false } }));
vi.mock('@/services/practiceEntryFlags', () => ({
  resolveAuthedFlag: vi.fn(),
  resolveAuthedDefaultPath: vi.fn(),
}));
// Keep the page inert (no analytics side effects) — routing/landmark structure is what we assert.
vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(), trackPracticeModeSelected: vi.fn(), trackPracticeOverviewExpanded: vi.fn(),
  trackQuickPracticeStarted: vi.fn(), trackGuidedRehearsalPreviewViewed: vi.fn(),
}));

const mockedAuth = vi.mocked(useAuthProvider);
const mockedFlag = vi.mocked(resolveAuthedFlag);
const mockedDefault = vi.mocked(resolveAuthedDefaultPath);
const asUser = (id: string | null) => ({ user: id ? { id } : null } as ReturnType<typeof useAuthProvider>);

function renderAt(initial: string, entryElement?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      {/* Mirror App.tsx: the single page <main> landmark lives here, above the routes. */}
      <main id="main-content">
        <Routes>
          {entryElement ? <Route path={initial} element={entryElement} /> : null}
          <Route path="/practice" element={<PracticeEntryGate><PracticePage /></PracticeEntryGate>} />
          <Route path="/session" element={<div data-testid="session-page">SESSION</div>} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}

describe('PracticeEntryGate — direct /practice obeys the rollout gate', () => {
  beforeEach(() => { mockedAuth.mockReset(); mockedFlag.mockReset(); });

  it('flag ON → renders the chooser (and still exactly ONE main landmark / #main-content)', async () => {
    mockedAuth.mockReturnValue(asUser('u1'));
    mockedFlag.mockResolvedValue(true);
    render(
      <MemoryRouter initialEntries={['/practice']}>
        <main id="main-content">
          <Routes>
            <Route path="/practice" element={<PracticeEntryGate><PracticePage /></PracticeEntryGate>} />
            <Route path="/session" element={<div data-testid="session-page">SESSION</div>} />
          </Routes>
        </main>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('practice-root')).toBeInTheDocument();
    // The nested-<main> regression: App owns the only landmark; the page adds none.
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  });

  it('flag OFF → redirects a direct /practice visit to /session (real one-switch rollback)', async () => {
    mockedAuth.mockReturnValue(asUser('u1'));
    mockedFlag.mockResolvedValue(false);
    renderAt('/practice');
    expect(await screen.findByTestId('session-page')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-root')).not.toBeInTheDocument();
  });

  it('no authenticated user → gate denies → /session', async () => {
    mockedAuth.mockReturnValue(asUser(null));
    mockedFlag.mockResolvedValue(true); // even if it would be ON, no identity ⇒ deny
    renderAt('/practice');
    expect(await screen.findByTestId('session-page')).toBeInTheDocument();
  });
});

describe('PostAuthRedirect — resolves the authenticated default before navigating', () => {
  beforeEach(() => { mockedAuth.mockReset(); mockedDefault.mockReset(); });

  it('targeted → /practice', async () => {
    mockedAuth.mockReturnValue(asUser('u1'));
    mockedFlag.mockResolvedValue(true);
    mockedDefault.mockResolvedValue('/practice');
    renderAt('/auth', <PostAuthRedirect from={null} />);
    expect(await screen.findByTestId('practice-root')).toBeInTheDocument();
  });

  it('non-targeted / timeout → /session', async () => {
    mockedAuth.mockReturnValue(asUser('u1'));
    mockedDefault.mockResolvedValue('/session');
    renderAt('/auth', <PostAuthRedirect from={null} />);
    expect(await screen.findByTestId('session-page')).toBeInTheDocument();
  });

  it('honors a safe deep-link destination', async () => {
    mockedAuth.mockReturnValue(asUser('u1'));
    mockedDefault.mockResolvedValue('/session'); // resolver already applied the deep-link decision
    renderAt('/auth', <PostAuthRedirect from={{ pathname: '/session' }} />);
    expect(await screen.findByTestId('session-page')).toBeInTheDocument();
    expect(mockedDefault).toHaveBeenCalledWith('u1', { pathname: '/session' });
  });
});
