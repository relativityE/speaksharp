import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '../../../tests/support/test-utils';
import PracticePage from '../PracticePage';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(),
  trackPracticeModeSelected: vi.fn(),
  trackFreeformPracticeStarted: vi.fn(),
  trackObjectiveUnavailable: vi.fn(),
}));
// The waitlist submit is mocked so the dialog can be exercised without a network call.
const submitWaitlist = vi.fn();
vi.mock('@/services/objectiveWaitlistService', () => ({
  submitGuidedWaitlist: (...a: unknown[]) => submitWaitlist(...a),
}));

// #1061: PracticePage is the ONE canonical auth-aware page. Default = authenticated; anon tests set null.
let mockUser: { id: string; email?: string } | null = { id: 'u-1', email: 'me@example.com' };
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return { ...actual, useAuthProvider: () => ({ user: mockUser }) };
});

// #1093: Home reads the server-authoritative streak via the get_practice_streak RPC (NOT the dead
// check_usage_limit.streak_count). The chip renders ONLY for an active >=2-day streak; in this unit
// context the RPC does not resolve, so the chip is hidden (no skeleton, no placeholder).
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: undefined }) }));
vi.mock('@/hooks/useRecentPracticeSummary', () => ({ useRecentPracticeSummary: vi.fn() }));
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
const mockHistory = vi.mocked(useRecentPracticeSummary);
type HistoryReturn = ReturnType<typeof useRecentPracticeSummary>;

const root = () => screen.getByTestId('practice-root');

describe('PracticePage — one canonical auth-aware page (#1061)', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    submitWaitlist.mockReset();
    submitWaitlist.mockResolvedValue({ ok: true });
    mockUser = { id: 'u-1', email: 'me@example.com' };
    mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
  });

  it('does NOT render its own <main> landmark (App owns the sole one)', () => {
    const { container } = render(<PracticePage />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(container.querySelector('#main-content')).toBeNull();
  });

  it('shows both product identities; Objective carries the SOON header badge + launch CTA', () => {
    render(<PracticePage />);
    expect(within(root()).getByRole('heading', { name: /^Rough Drafts$/i })).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Focus Points$/i })).toBeInTheDocument();
    // Objective "coming soon" is conveyed by the SOON header badge + the "Notify me at launch" CTA.
    const badge = screen.getByTestId('objective-soon-badge');
    expect(badge).toHaveTextContent('SOON');
    expect(within(root()).getByText(/notify me at launch/i)).toBeInTheDocument();
    // No user-facing "Planned" anywhere.
    expect(root().textContent ?? '').not.toMatch(/Planned/);
  });

  describe('authenticated state (`/practice`)', () => {
    it('asks the choice question and shows both product-card CTAs — no marketing copy (#1047)', () => {
      mockHistory.mockReturnValue({
        data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
        isLoading: false,
      } as unknown as HistoryReturn);
      render(<PracticePage />);
      expect(screen.getByTestId('practice-welcome-authed')).toHaveTextContent(/welcome back/i);
      expect(screen.getByTestId('practice-welcome-authed')).toHaveTextContent(/what would you like to do\?/i);
      // No anonymous marketing support section, hero or tagline after login.
      expect(screen.queryByTestId('practice-support-heading')).not.toBeInTheDocument();
      expect(screen.queryByTestId('practice-hero-start-free')).not.toBeInTheDocument();
      expect(root().textContent ?? '').not.toMatch(/Public Impact/i);
      // Product cards own their actions.
      expect(screen.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start your session/i);
      expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/notify me about focus points/i);
    });

    it('Freeform navigates DIRECTLY to /session', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-freeform'));
      expect(navigateSpy).toHaveBeenCalledWith('/session');
    });

    it('Objective "Notify me" opens the gated coming-soon dialog (waitlist OFF) — no form, no backend call, no nav', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-objective'));
      expect(await screen.findByTestId('objective-notify-dialog')).toBeInTheDocument();
      // Activation flag is OFF by default → honest coming-soon acknowledgement, NOT the capture form.
      expect(screen.getByTestId('objective-notify-comingsoon')).toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-email')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('returning user: Last session → /analytics/<id>, Analytics → /analytics', () => {
      mockHistory.mockReturnValue({
        data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
        isLoading: false,
      } as unknown as HistoryReturn);
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('home-last-session'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics/sess-9');
      fireEvent.click(screen.getByTestId('home-analytics'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics');
    });

    it('first run: the empty state explains itself and leads nowhere (never a fabricated 0:00)', () => {
      mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
      render(<PracticePage />);
      // A successful read that genuinely returned nothing says so, and offers first-run guidance —
      // it is not the em-dash placeholder, which would be a claim we had looked and found nothing
      // displayable, and not the failure state.
      expect(screen.getByTestId('home-last-session-secondary')).toHaveTextContent('No sessions yet');
      expect(screen.getByTestId('home-first-run')).toHaveTextContent(/start your first practice/i);
      expect(screen.queryByTestId('home-history-error')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-last-session')).toBeDisabled();
      fireEvent.click(screen.getByTestId('home-last-session'));
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('the streak chip is backed by get_practice_streak, hidden until an active >=2-day streak resolves — never check_usage_limit.streak_count', () => {
      mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
      render(<PracticePage />);
      // The server RPC does not resolve in this unit context, so the chip is HIDDEN (the contract shows
      // it only for an active >=2-day streak). It is NOT synchronously derived from the dead
      // check_usage_limit.streak_count — which would have rendered a chip here.
      expect(screen.queryByTestId('home-streak-chip')).not.toBeInTheDocument();
      // the rest of the continuity cluster still renders (it leads with Last session → Analytics).
      expect(screen.getByTestId('home-last-session')).toBeInTheDocument();
      expect(screen.getByTestId('home-analytics')).toBeInTheDocument();
    });
  });

  describe('anonymous state (`/`)', () => {
    beforeEach(() => { mockUser = null; });

    it('shows the large hero, the Freeform FREE TRIAL strip, and product cards WITH their own CTAs (no support section / continuity)', () => {
      render(<PracticePage />);
      expect(screen.getByTestId('practice-hero-start-free')).toBeVisible();
      // Freeform FREE TRIAL strip (the four support cards + connectors are removed).
      const strip = screen.getByTestId('freeform-trial-strip');
      expect(strip).toHaveTextContent(/free trial/i);
      expect(strip).toHaveTextContent(/try a 5-minute private session — no card, no script\./i);
      expect(screen.queryByTestId('support-freeform-explain')).not.toBeInTheDocument();
      // Objective status is the SOON header badge (never "Planned").
      expect(within(screen.getByTestId('practice-card-objective-card')).getByTestId('objective-soon-badge')).toHaveTextContent('SOON');
      expect(screen.queryByText(/Planned/)).toBeNull();
      // Product cards own their actions (anon shows CTAs, same as authed).
      expect(screen.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start your session/i);
      expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/notify me about focus points/i);
      // No authenticated continuity/account actions.
      expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
      expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
    });

    it('Start free → signup → /practice', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-hero-start-free'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup');
    });

    it('Freeform FREE TRIAL strip CTA → account access carrying the Private-trial intent (no auto-record)', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('freeform-trial-start'));
      // The band promises Private, so the intent rides through signup via from.search (resolvePostAuthPath
      // preserves it) → /session?trial=private. NOT a bare /session that silently lands on Browser.
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session', search: '?trial=private' } } });
    });

    it('Freeform product card CTA → account access preserving /session intent', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-freeform'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
    });

    it('Objective product card opens the gated coming-soon dialog (waitlist OFF), no form, no navigation', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-objective'));
      expect(await screen.findByTestId('objective-notify-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('objective-notify-comingsoon')).toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-email')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
  // The ENABLED capture-form path (validation / honest success / honest failure) is covered directly in
  // ObjectiveNotifyDialog.test.tsx with enabled={true}, independent of the page's activation flag.
});
