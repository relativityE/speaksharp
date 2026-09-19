import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '../../../tests/support/test-utils';
import PracticePage from '../PracticePage';
import { PRODUCT_NAMES } from '@/constants/productNames';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(),
  trackPracticeModeSelected: vi.fn(),
  trackFreeformPracticeStarted: vi.fn(),
}));

// #1046 slice 5b: Focus Points is ACTIVATED. The card opens the capture form (ObjectiveSetupForm),
// which persists a brief via issue_objective_* RPCs. These tests only OPEN the dialog (no submit), so
// the brief service is never called and the real store is left untouched — no store/network mock needed.

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
    mockUser = { id: 'u-1', email: 'me@example.com' };
    mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
  });

  it('does NOT render its own <main> landmark (App owns the sole one)', () => {
    const { container } = render(<PracticePage />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(container.querySelector('#main-content')).toBeNull();
  });

  it('shows both product identities; Focus Points is ACTIVATED — no SOON badge, a real start CTA (#1046 5b)', () => {
    render(<PracticePage />);
    expect(within(root()).getByRole('heading', { name: new RegExp(`^${PRODUCT_NAMES.freeform}$`, 'i') })).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Focus Points$/i })).toBeInTheDocument();
    // The pre-launch "coming soon" affordances are gone: no SOON badge, no "notify me" CTA.
    expect(screen.queryByTestId('objective-soon-badge')).not.toBeInTheDocument();
    expect(within(root()).queryByText(/notify me/i)).not.toBeInTheDocument();
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
      expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/start focus points/i);
    });

    it('Freeform navigates DIRECTLY to /session', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-freeform'));
      expect(navigateSpy).toHaveBeenCalledWith('/session');
    });

    it('Focus Points opens the capture dialog (no navigation until a brief is saved)', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-objective'));
      expect(await screen.findByTestId('objective-setup-dialog')).toBeInTheDocument();
      // The real capture form — a goal field + focus-point inputs — not the retired notify form.
      expect(screen.getByTestId('objective-setup-form')).toBeInTheDocument();
      expect(screen.queryByTestId('objective-notify-dialog')).not.toBeInTheDocument();
      // Opening navigates nowhere — the route into the session happens on a saved brief (onReady).
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('returning user: the resume band → /analytics/<id>, Analytics → /analytics', () => {
      mockHistory.mockReturnValue({
        data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
        isLoading: false,
      } as unknown as HistoryReturn);
      render(<PracticePage />);
      // H-4: for a returning user the resume band OWNS this destination, and the legacy corner chip is
      // hidden so two controls never point at the same review. The routing contract is unchanged.
      expect(screen.queryByTestId('home-last-session')).toBeNull();
      fireEvent.click(screen.getByTestId('home-resume-cta'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics/sess-9');
      fireEvent.click(screen.getByTestId('home-resume-progress'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics');
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
      expect(screen.getByTestId('home-first-run')).toHaveTextContent(/your audio never leaves this browser/i);
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

    it('shows the #1475 G12 homepage: hero with the complete offer, products, Practice Loop, pricing and closing CTA (no continuity)', () => {
      render(<PracticePage />);
      expect(screen.getByTestId('practice-hero-start-free')).toBeVisible();
      for (const region of [/hero/i, /products/i, /practice loop/i, /pricing/i, /call to action/i]) {
        expect(screen.getByRole('region', { name: region })).toBeInTheDocument();
      }
      // The retired teal trial strip is replaced by the complete offer at every signup decision point.
      expect(screen.queryByTestId('freeform-trial-strip')).not.toBeInTheDocument();
      // G17 L1: one terms line in the hero pairs the trial with its post-trial price.
      expect(screen.getByRole('region', { name: /^hero$/i })).toHaveTextContent('Free for 30 days, $10/month after.');
      expect(screen.queryByTestId('support-freeform-explain')).not.toBeInTheDocument();
      // Focus Points is activated — no SOON badge on the anonymous card either.
      expect(screen.queryByTestId('objective-soon-badge')).not.toBeInTheDocument();
      expect(screen.queryByText(/Planned/)).toBeNull();
      // Product cards own their actions; on the G12 homepage each visible label is its accessible name.
      expect(screen.getByTestId('practice-card-freeform')).toHaveAccessibleName(/start open mic/i);
      expect(screen.getByTestId('practice-card-objective')).toHaveAccessibleName(/start focus points/i);
      // No authenticated continuity/account actions.
      expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
      expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
    });

    it('hero "Start your session" is a real link to the signup destination', () => {
      render(<PracticePage />);
      const cta = screen.getByTestId('practice-hero-start-free');
      expect(cta).toHaveAccessibleName('Start your session');
      expect(cta).toHaveAttribute('href', '/auth/signup');
    });

    it('closing CTA is a real link to the signup destination, with its value sentence and no terms (G17 L1)', () => {
      render(<PracticePage />);
      const closing = screen.getByRole('region', { name: /call to action/i });
      expect(within(closing).getByRole('link', { name: 'Start your session' })).toHaveAttribute('href', '/auth/signup');
      expect(closing).toHaveTextContent('Your recordings stay Private on this device.');
      expect(closing).not.toHaveTextContent(/30 day|\$10/i);
    });

    it('Freeform product card CTA → account access preserving /session intent', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-freeform'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
    });

    it('Focus Points (anonymous) → sign-up first (the brief RPCs require auth); no capture dialog', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-objective'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/practice' } } });
      expect(screen.queryByTestId('objective-setup-dialog')).not.toBeInTheDocument();
    });
  });
});
