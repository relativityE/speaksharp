import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithAllProviders } from '../../tests/support/test-utils/render';

// Deterministically control the internal-routes gate so we can assert the
// PRODUCTION posture (internal routes disabled) without env juggling.
const { mockAreInternalRoutesEnabled } = vi.hoisted(() => ({
  mockAreInternalRoutesEnabled: vi.fn(),
}));
vi.mock('@/config/internalRoutes', () => ({
  areInternalRoutesEnabled: () => mockAreInternalRoutesEnabled(),
}));

// Same lightweight page/provider mocks as App.boot.test so <App /> renders cheaply.
vi.mock('../components/Navigation', () => ({ default: () => <nav data-testid="navigation" /> }));
vi.mock('../components/ProfileGuard', () => ({
  ProfileGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/ui/PageTransition', () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/hooks/useCheckoutNotifications', () => ({ useCheckoutNotifications: vi.fn() }));
vi.mock('../hooks/useCriticalQueries', () => ({ useCriticalQueries: () => ({ isResolved: true }) }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // #1416 — `App` now gives `AnimatePresence` a keyed `motion.div` so `popLayout` has an immediate
  // child it can compose a ref onto. A mock that returns only `AnimatePresence` fails the moment the
  // source uses anything else, and reports it as seven unrelated routing failures.
  motion: new Proxy({}, {
    get: () => ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
      <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    ),
  }),
}));
vi.mock('../pages/Index', () => ({ default: () => <div data-testid="index-page" /> }));
vi.mock('../pages/SignInPage', () => ({ default: () => <div data-testid="signin-page" /> }));
vi.mock('../pages/AuthPage', () => ({ default: () => <div data-testid="signup-page" /> }));
vi.mock('../pages/PricingPage', () => ({ PricingPage: () => <div data-testid="pricing-page" /> }));
vi.mock('../pages/LegalPage', () => ({
  TermsPage: () => <div data-testid="terms-page" />,
  PrivacyPage: () => <div data-testid="privacy-page" />,
}));
vi.mock('../pages/NotFoundPage', () => ({ NotFoundPage: () => <div data-testid="not-found-page" /> }));
vi.mock('../pages/SessionPage', () => ({ default: () => <div data-testid="session-page" /> }));
vi.mock('../pages/AnalyticsPage', () => ({ default: () => <div data-testid="analytics-page" /> }));
vi.mock('../pages/DesignSystemPage', () => ({ default: () => <div data-testid="design-page" /> }));
vi.mock('../pages/OpsStatusPage', () => ({ OpsStatusPage: () => <div data-testid="ops-page" /> }));
vi.mock('../providers/TranscriptionProvider', () => ({
  TranscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import App from '../App';

describe('internal-routes gating — production posture (internal routes DISABLED)', () => {
  beforeEach(() => {
    // Simulates a production build with VITE_ENABLE_INTERNAL_ROUTES unset.
    mockAreInternalRoutesEnabled.mockReturnValue(false);
  });

  it('(a) renders /admin/ops-status even when internal routes are disabled — middleware is its only gate', async () => {
    renderWithAllProviders(<App />, { route: '/admin/ops-status' });

    expect(await screen.findByTestId('ops-page')).toBeInTheDocument();
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
  });

  it('(b) keeps /design behind InternalRoute → NotFound when internal routes are disabled', async () => {
    renderWithAllProviders(<App />, { route: '/design' });

    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.queryByTestId('design-page')).not.toBeInTheDocument();
  });

  it('(b′) shows /design when internal routes are explicitly enabled (dev/preview)', async () => {
    mockAreInternalRoutesEnabled.mockReturnValue(true);
    renderWithAllProviders(<App />, { route: '/design' });

    expect(await screen.findByTestId('design-page')).toBeInTheDocument();
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
  });
});

// SECURITY (case-variant auth bypass): React Router is case-insensitive by default, and the edge
// middleware only challenges the exact lowercase path, so without `caseSensitive` on the route a variant
// like /Admin/Ops-Status would render the ops page unauthenticated once InternalRoute was removed.
describe('ops-status route case-sensitivity (production posture)', () => {
  beforeEach(() => {
    mockAreInternalRoutesEnabled.mockReturnValue(false);
  });

  it('renders OpsStatusPage at the exact lowercase /admin/ops-status', async () => {
    renderWithAllProviders(<App />, { route: '/admin/ops-status' });

    expect(await screen.findByTestId('ops-page')).toBeInTheDocument();
    expect(screen.queryByTestId('not-found-page')).not.toBeInTheDocument();
  });

  it.each([
    '/Admin/Ops-Status',
    '/ADMIN/OPS-STATUS',
    '/admin/Ops-Status',
  ])('does NOT render OpsStatusPage for case variant %s — caseSensitive route falls through to NotFound', async (route) => {
    renderWithAllProviders(<App />, { route });

    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.queryByTestId('ops-page')).not.toBeInTheDocument();
  });
});
