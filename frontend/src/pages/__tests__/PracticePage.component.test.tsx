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
  trackQuickPracticeStarted: vi.fn(),
  trackGuidedRehearsalUnavailable: vi.fn(),
}));
// The waitlist submit is mocked so the dialog can be exercised without a network call.
const submitWaitlist = vi.fn();
vi.mock('@/services/guidedWaitlistService', () => ({
  submitGuidedWaitlist: (...a: unknown[]) => submitWaitlist(...a),
}));

// #1061: PracticePage is the ONE canonical auth-aware page. Default = authenticated; anon tests set null.
let mockUser: { id: string; email?: string } | null = { id: 'u-1', email: 'me@example.com' };
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return { ...actual, useAuthProvider: () => ({ user: mockUser }) };
});

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

  it('shows both product identities; Guided carries the SOON header badge + launch CTA', () => {
    render(<PracticePage />);
    expect(within(root()).getByRole('heading', { name: /^Freestyle Practice$/i })).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
    // Guided "coming soon" is conveyed by the SOON header badge + the "Notify me at launch" CTA.
    const badge = screen.getByTestId('guided-soon-badge');
    expect(badge).toHaveTextContent('SOON');
    expect(within(root()).getByText(/notify me at launch/i)).toBeInTheDocument();
    // No user-facing "Planned" anywhere.
    expect(root().textContent ?? '').not.toMatch(/Planned/);
  });

  describe('authenticated state (`/practice`)', () => {
    it('shows the compact welcome, continuity, and product-card CTAs', () => {
      mockHistory.mockReturnValue({
        data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
        isLoading: false,
      } as unknown as HistoryReturn);
      render(<PracticePage />);
      expect(screen.getByTestId('practice-welcome-authed')).toHaveTextContent(/welcome back/i);
      expect(screen.getByTestId('practice-welcome-authed')).toHaveTextContent(/what would you like to practice\?/i);
      expect(screen.getByTestId('practice-continuity')).toBeInTheDocument();
      // No anonymous marketing support section after login.
      expect(screen.queryByTestId('practice-support')).not.toBeInTheDocument();
      // Product cards own their actions.
      expect(screen.getByTestId('practice-card-quick')).toHaveAccessibleName(/start freestyle practice/i);
      expect(screen.getByTestId('practice-card-guided')).toHaveAccessibleName(/notify me about guided rehearsal/i);
    });

    it('Freestyle navigates DIRECTLY to /session', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      expect(navigateSpy).toHaveBeenCalledWith('/session');
    });

    it('Guided "Notify me" opens the gated coming-soon dialog (waitlist OFF) — no form, no backend call, no nav', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-guided'));
      expect(await screen.findByTestId('guided-notify-dialog')).toBeInTheDocument();
      // Activation flag is OFF by default → honest coming-soon acknowledgement, NOT the capture form.
      expect(screen.getByTestId('guided-notify-comingsoon')).toBeInTheDocument();
      expect(screen.queryByTestId('guided-notify-email')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('returning user: Review → /analytics/<id>, View analytics → /analytics', () => {
      mockHistory.mockReturnValue({
        data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
        isLoading: false,
      } as unknown as HistoryReturn);
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-continuity-review'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics/sess-9');
      fireEvent.click(screen.getByTestId('practice-continuity-analytics'));
      expect(navigateSpy).toHaveBeenCalledWith('/analytics');
    });
  });

  describe('anonymous state (`/`)', () => {
    beforeEach(() => { mockUser = null; });

    it('shows the large hero, the Freestyle FREE TRIAL strip, and product cards WITH their own CTAs (no support section / continuity)', () => {
      render(<PracticePage />);
      expect(screen.getByTestId('practice-hero-start-free')).toBeVisible();
      // Freestyle FREE TRIAL strip (the four support cards + connectors are removed).
      const strip = screen.getByTestId('freestyle-trial-strip');
      expect(strip).toHaveTextContent(/free trial/i);
      expect(strip).toHaveTextContent(/try a 5-minute private session — no card, no script\./i);
      expect(screen.queryByTestId('support-freestyle-explain')).not.toBeInTheDocument();
      // Guided status is the SOON header badge (never "Planned").
      expect(within(screen.getByTestId('practice-card-guided-card')).getByTestId('guided-soon-badge')).toHaveTextContent('SOON');
      expect(screen.queryByText(/Planned/)).toBeNull();
      // Product cards own their actions (anon shows CTAs, same as authed).
      expect(screen.getByTestId('practice-card-quick')).toHaveAccessibleName(/start freestyle practice/i);
      expect(screen.getByTestId('practice-card-guided')).toHaveAccessibleName(/notify me about guided rehearsal/i);
      // No authenticated continuity/account actions.
      expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
      expect(screen.queryByTestId('practice-continuity-empty')).not.toBeInTheDocument();
    });

    it('Start free → signup → /practice', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-hero-start-free'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup');
    });

    it('Freestyle FREE TRIAL strip CTA → account access preserving /session intent (no auto-record)', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('freestyle-trial-start'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
    });

    it('Freestyle product card CTA → account access preserving /session intent', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', { state: { from: { pathname: '/session' } } });
    });

    it('Guided product card opens the gated coming-soon dialog (waitlist OFF), no form, no navigation', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-guided'));
      expect(await screen.findByTestId('guided-notify-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('guided-notify-comingsoon')).toBeInTheDocument();
      expect(screen.queryByTestId('guided-notify-email')).not.toBeInTheDocument();
      expect(submitWaitlist).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  });
  // The ENABLED capture-form path (validation / honest success / honest failure) is covered directly in
  // GuidedNotifyDialog.test.tsx with enabled={true}, independent of the page's activation flag.
});
