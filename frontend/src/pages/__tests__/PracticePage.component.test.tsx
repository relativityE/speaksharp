import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '../../../tests/support/test-utils';
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
import { trackQuickPracticeStarted } from '@/services/practiceTelemetry';
import {
  clearSessionRecoveryDraft,
  saveSessionRecoveryDraft,
  SESSION_RECOVERY_DRAFT_STORAGE_KEY,
} from '@/services/sessionRecoveryDraft';
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

// #1093: Home reads the server-authoritative streak via the get_practice_streak RPC (NOT the dead
// check_usage_limit.streak_count). The chip renders ONLY for an active >=2-day streak; in this unit
// context the RPC does not resolve, so the chip is hidden (no skeleton, no placeholder).
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: undefined }) }));
vi.mock('@/hooks/useRecentPracticeSummary', () => ({ useRecentPracticeSummary: vi.fn() }));
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
const mockHistory = vi.mocked(useRecentPracticeSummary);
const quickPracticeStarted = vi.mocked(trackQuickPracticeStarted);
type HistoryReturn = ReturnType<typeof useRecentPracticeSummary>;

const root = () => screen.getByTestId('practice-root');

describe('PracticePage — one canonical auth-aware page (#1061)', () => {
  beforeEach(() => {
    localStorage.clear();
    navigateSpy.mockReset();
    quickPracticeStarted.mockClear();
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
      expect(screen.getByTestId('practice-card-quick')).toHaveAccessibleName(/start freestyle practice/i);
      expect(screen.getByTestId('practice-card-guided')).toHaveAccessibleName(/notify me about guided rehearsal/i);
    });

    it('Freestyle opens the optional on-ramp and preserves its stable selections into /session', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      expect(screen.getByTestId('freestyle-onramp-dialog')).toBeInTheDocument();
      expect(quickPracticeStarted).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('radio', { name: 'Be more concise' }));
      fireEvent.click(screen.getByRole('button', { name: 'Give me a prompt' }));
      fireEvent.click(screen.getByTestId('continue-freestyle-button'));
      expect(quickPracticeStarted).toHaveBeenCalledTimes(1);
      expect(quickPracticeStarted).toHaveBeenCalledWith('landing_card');
      expect(navigateSpy).toHaveBeenCalledWith('/session?focus=concise&prompt=recent-work');
    });

    it('does not report practice started when optional setup is canceled', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(quickPracticeStarted).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('blocks calibration when the authenticated owner has an unsaved recovery draft', () => {
      saveSessionRecoveryDraft({
        sessionId: 'recover-me',
        userId: 'u-1',
        transcript: 'unsaved private words',
        durationSeconds: 12,
        mode: 'private',
      });
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeDisabled();
      expect(screen.getByText(/Finish the current recording or recovery step/)).toBeInTheDocument();
    });

    it('does not expose another account recovery draft through the calibration guard', () => {
      saveSessionRecoveryDraft({
        sessionId: 'other-account',
        userId: 'user-B',
        transcript: 'another account private words',
        durationSeconds: 12,
        mode: 'private',
      });
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeEnabled();
    });

    it('reacts to owner-scoped recovery changes from another tab without a reload', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      const calibrationButton = screen.getByRole('button', { name: 'Let me test with a sample' });
      expect(calibrationButton).toBeEnabled();

      saveSessionRecoveryDraft({
        sessionId: 'cross-tab-owner-draft',
        userId: 'u-1',
        transcript: 'new unsaved private words',
        durationSeconds: 14,
        mode: 'private',
      });
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_RECOVERY_DRAFT_STORAGE_KEY }));
      await waitFor(() => expect(calibrationButton).toBeDisabled());

      clearSessionRecoveryDraft('cross-tab-owner-draft');
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_RECOVERY_DRAFT_STORAGE_KEY }));
      await waitFor(() => expect(calibrationButton).toBeEnabled());
    });

    it('ignores another account recovery storage event for the calibration guard', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      const calibrationButton = screen.getByRole('button', { name: 'Let me test with a sample' });

      saveSessionRecoveryDraft({
        sessionId: 'cross-tab-other-owner',
        userId: 'user-B',
        transcript: 'another account private words',
        durationSeconds: 14,
        mode: 'private',
      });
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_RECOVERY_DRAFT_STORAGE_KEY }));
      await waitFor(() => expect(calibrationButton).toBeEnabled());
    });

    it('rechecks recovery at Start when another tab writes the current owner draft after mount', async () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
      saveSessionRecoveryDraft({
        sessionId: 'cross-tab-after-mount',
        userId: 'u-1',
        transcript: 'new unsaved private words',
        durationSeconds: 14,
        mode: 'private',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Finish the current recording or recovery step/);
      expect(localStorage.getItem('speaksharp_active_session_lock')).toBeNull();
    });

    it('fails calibration closed when recovery storage cannot be inspected', () => {
      const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('storage denied', 'SecurityError');
      });
      try {
        render(<PracticePage />);
        fireEvent.click(screen.getByTestId('practice-card-quick'));
        expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeDisabled();
      } finally {
        read.mockRestore();
      }
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

    it('Freestyle FREE TRIAL preserves Private-trial and optional setup through account access', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('freestyle-trial-start'));
      fireEvent.click(screen.getByRole('radio', { name: 'Deliver clearly' }));
      fireEvent.click(screen.getByTestId('continue-freestyle-button'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', {
        state: { from: { pathname: '/session', search: '?focus=clarity&trial=private' } },
      });
    });

    it('Freestyle product card preserves focus and prompt through signup', () => {
      render(<PracticePage />);
      fireEvent.click(screen.getByTestId('practice-card-quick'));
      fireEvent.click(screen.getByRole('radio', { name: 'Reduce filler words' }));
      fireEvent.click(screen.getByRole('button', { name: 'Give me a prompt' }));
      fireEvent.click(screen.getByTestId('continue-freestyle-button'));
      expect(navigateSpy).toHaveBeenCalledWith('/auth/signup', {
        state: { from: { pathname: '/session', search: '?focus=fillers&prompt=recent-work' } },
      });
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
