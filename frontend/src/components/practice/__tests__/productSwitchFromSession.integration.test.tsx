import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';
import PracticePage from '@/pages/PracticePage';
import { PracticeSurfaceProvider } from '@/components/practice/PracticeSurfaceContext';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * #1416 — moving between products from the SESSION route, proven through the rendered parent.
 *
 * The e2e proof for this outcome (`public-product-discovery`) failed on the #1416 branch, and a
 * component test of Navigation alone cannot say why: it can prove the menu item carries the right
 * href, but the outcome the user cares about is that the destination actually opens Focus Points.
 * That spans two components — the header emits `/practice?product=focus-points`, and `PracticePage`
 * must turn that parameter into an open setup dialog. This renders both under one router so the
 * seam between them is exercised rather than assumed.
 */

vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(),
  trackPracticeModeSelected: vi.fn(),
  trackFreeformPracticeStarted: vi.fn(),
}));
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: undefined }) }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ data: { subscription_status: 'pro' } }) }));
vi.mock('@/hooks/useRecentPracticeSummary', () => ({
  useRecentPracticeSummary: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return {
    ...actual,
    useAuthProvider: () => ({ user: { id: 'u-1' }, session: { user: { id: 'u-1' } }, signOut: vi.fn() }),
  };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderApp = (initial: string) => render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[initial]}>
      <PracticeSurfaceProvider>
        <Navigation />
        <Routes>
          <Route path="/session" element={<div data-testid="session-page">SESSION</div>} />
          <Route path="/practice" element={<PracticePage />} />
        </Routes>
      </PracticeSurfaceProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

describe('#1416 product switching from the session route', () => {
  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });

  it('Products → Focus Points from /session opens the Focus Points setup', async () => {
    const user = userEvent.setup();
    renderApp('/session');
    expect(screen.getByTestId('session-page')).toBeInTheDocument();

    await user.click(screen.getByTestId('nav-products-button'));
    await user.click(await screen.findByTestId('nav-products-focus-points'));

    expect(await screen.findByTestId('practice-root')).toBeInTheDocument();
    expect(await screen.findByTestId('objective-setup-dialog')).toBeInTheDocument();
  });

  it('Products → Open Mic from a bound Focus Points session actually leaves Focus Points', async () => {
    useSessionStore.getState().setActiveObjectiveBrief({ projectId: 'p1', briefId: 'b1', points: ['a', 'b'] });
    const user = userEvent.setup();
    renderApp('/session');

    await user.click(screen.getByTestId('nav-products-button'));
    await user.click(await screen.findByTestId('nav-products-open-mic'));

    await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief).toBeNull());
  });

  // #1416 — A TAKE IN FLIGHT IS NOT RELABELLED.
  //
  // Retiring the brief while Focus Points is recording switches the heading, the points rail and the
  // coverage card to Open Mic while the microphone keeps capturing a session that was STARTED as
  // Focus Points and will be saved and evaluated as one. The user is told they are in a product they
  // are not in, and the recording's own start-boundary attribution disagrees with the screen.
  describe('switching product during an active take', () => {
    const startFocusPointsTake = () => {
      useSessionStore.getState().setActiveObjectiveBrief({
        projectId: 'p1', briefId: 'b1', points: ['Name the price', 'State the guarantee'], topic: 'Pitch',
      });
      useSessionStore.setState({ isListening: true });
    };

    it.each([
      ['desktop', 'nav-products-button', 'nav-products-open-mic'],
      ['mobile', 'nav-mobile-products-button', 'nav-mobile-products-open-mic'],
    ])('%s: the take stays coherently Focus Points until it settles', async (_surface, trigger, item) => {
      startFocusPointsTake();
      const user = userEvent.setup();
      renderApp('/session');

      await user.click(screen.getByTestId(trigger));
      await user.click(await screen.findByTestId(item));

      // The brief — which is what SessionPage, the controller policy, the saved row and the coverage
      // evaluation all read to decide the product — is untouched, points and all.
      const brief = useSessionStore.getState().activeObjectiveBrief;
      expect(brief).not.toBeNull();
      expect(brief?.briefId).toBe('b1');
      expect(brief?.points).toEqual(['Name the price', 'State the guarantee']);
      expect(brief?.topic).toBe('Pitch');

      // The switch is pending, not silent: a control that appears to do nothing is its own defect.
      expect(await screen.findByTestId('nav-open-mic-pending')).toBeInTheDocument();
    });

    it('applies the switch once the take settles, without a second click', async () => {
      startFocusPointsTake();
      const user = userEvent.setup();
      renderApp('/session');
      await user.click(screen.getByTestId('nav-products-button'));
      await user.click(await screen.findByTestId('nav-products-open-mic'));
      expect(useSessionStore.getState().activeObjectiveBrief).not.toBeNull();

      // The stop seam retires the brief once coverage is finalized; that is the authorized
      // transition, and it is where the deferred switch lands.
      act(() => {
        useSessionStore.setState({ isListening: false });
        useSessionStore.getState().setActiveObjectiveBrief(null);
      });

      await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief).toBeNull());
      await waitFor(() => expect(screen.queryByTestId('nav-open-mic-pending')).not.toBeInTheDocument());
    });

    it('still switches immediately when no take is running', async () => {
      useSessionStore.getState().setActiveObjectiveBrief({ projectId: 'p1', briefId: 'b1', points: ['a'] });
      const user = userEvent.setup();
      renderApp('/session');

      await user.click(screen.getByTestId('nav-products-button'));
      await user.click(await screen.findByTestId('nav-products-open-mic'));

      // Deferral is scoped to an active take. Between takes the switch is immediate, or finding 10
      // comes back.
      await waitFor(() => expect(useSessionStore.getState().activeObjectiveBrief).toBeNull());
      expect(screen.queryByTestId('nav-open-mic-pending')).not.toBeInTheDocument();
    });
  });

  it('the mobile control on the session route reaches Focus Points too', async () => {
    const user = userEvent.setup();
    renderApp('/session');

    await user.click(screen.getByTestId('nav-mobile-products-button'));
    await user.click(await screen.findByTestId('nav-mobile-products-focus-points'));

    expect(await screen.findByTestId('objective-setup-dialog')).toBeInTheDocument();
  });
});
