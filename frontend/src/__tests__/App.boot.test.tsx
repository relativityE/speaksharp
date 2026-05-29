import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithAllProviders } from '../../tests/support/test-utils/render';
import App from '../App';

vi.mock('../components/Navigation', () => ({
  default: () => <nav data-testid="navigation" />,
}));

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

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}));

vi.mock('@/hooks/useCheckoutNotifications', () => ({
  useCheckoutNotifications: vi.fn(),
}));

vi.mock('../hooks/useCriticalQueries', () => ({
  useCriticalQueries: () => ({ isResolved: true }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../pages/Index', () => ({
  default: () => <div data-testid="index-page" />,
}));

vi.mock('../pages/SignInPage', () => ({
  default: () => <div data-testid="signin-page" />,
}));

vi.mock('../pages/AuthPage', () => ({
  default: () => <div data-testid="signup-page" />,
}));

vi.mock('../pages/PricingPage', () => ({
  PricingPage: () => <div data-testid="pricing-page" />,
}));

vi.mock('../pages/LegalPage', () => ({
  TermsPage: () => <div data-testid="terms-page" />,
  PrivacyPage: () => <div data-testid="privacy-page" />,
}));

vi.mock('../pages/NotFoundPage', () => ({
  NotFoundPage: () => <div data-testid="not-found-page" />,
}));

vi.mock('../pages/SessionPage', () => ({
  default: () => <div data-testid="session-page" />,
}));

vi.mock('../pages/AnalyticsPage', () => ({
  default: () => <div data-testid="analytics-page" />,
}));

vi.mock('../pages/DesignSystemPage', () => ({
  default: () => <div data-testid="design-page" />,
}));

vi.mock('../pages/OpsStatusPage', () => ({
  OpsStatusPage: () => <div data-testid="ops-page" />,
}));

vi.mock('../providers/TranscriptionProvider', () => ({
  TranscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('App boot contract', () => {
  it('renders under the standard router shell without data-router-only APIs', async () => {
    renderWithAllProviders(<App />, { route: '/auth/signin' });

    expect(await screen.findByTestId('signin-page')).toBeInTheDocument();
  });
});
