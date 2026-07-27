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
  trackPracticeOverviewExpanded: vi.fn(),
  trackQuickPracticeStarted: vi.fn(),
  trackGuidedRehearsalUnavailable: vi.fn(),
}));
import { trackGuidedRehearsalUnavailable } from '@/services/practiceTelemetry';
const guidedTelemetry = vi.mocked(trackGuidedRehearsalUnavailable);

// #1042 PR4: the Practice Home continuity block reads the most-recent session via useRecentPracticeSummary.
// Mock it so these component tests don't need a QueryClient/Auth provider; default = new user (no sessions).
vi.mock('@/hooks/useRecentPracticeSummary', () => ({ useRecentPracticeSummary: vi.fn() }));
import { useRecentPracticeSummary } from '@/hooks/useRecentPracticeSummary';
const mockHistory = vi.mocked(useRecentPracticeSummary);
type HistoryReturn = ReturnType<typeof useRecentPracticeSummary>;

// PracticePage no longer renders its own <main> — App.tsx owns the single #main-content landmark, so in
// isolation we scope queries to the page's content container instead of a main landmark.
const root = () => screen.getByTestId('practice-root');

describe('PracticePage — orientation entry (Quick → /session; Guided stays inline)', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    guidedTelemetry.mockClear();
    // Default: new user (no sessions) → truthful empty continuity state.
    mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
  });

  it('does NOT render a <main> landmark or #main-content (App owns the sole one)', () => {
    const { container } = render(<PracticePage />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(container.querySelector('#main-content')).toBeNull();
  });

  it('lands on the chooser: tagline, decision prompt, and both modes', () => {
    render(<PracticePage />);
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(within(root()).getByText(/choose how you want to practice/i)).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Freestyle Practice$/i })).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
  });

  it('presents each product as a short visual list (3 concise items), not a dense paragraph', () => {
    render(<PracticePage />);
    const [quickCard, guidedCard] = within(root()).getAllByRole('article');
    // Quick — three scannable capabilities as list items.
    for (const item of ['No agenda or setup', 'Speak and see your live transcript', 'Review fillers, delivery, and progress']) {
      expect(within(quickCard).getByText(item)).toBeInTheDocument();
    }
    expect(within(quickCard).getAllByRole('listitem')).toHaveLength(3);
    // Guided — three capabilities, phrased as the planned (not operational) outcome.
    for (const item of ['Prepare the points you need to cover', 'Track covered and missed points', 'Rehearse corrections before the real moment']) {
      expect(within(guidedCard).getByText(item)).toBeInTheDocument();
    }
    expect(within(guidedCard).getAllByRole('listitem')).toHaveLength(3);
  });

  it('each mode card is a semantic <article> with a real keyboard-operable CTA button', () => {
    render(<PracticePage />);
    const cards = within(root()).getAllByRole('article');
    expect(cards.length).toBe(2);
    // The CTA is a real <button> (keyboard-operable), not a card-as-button wrapping headings.
    const quickCta = screen.getByTestId('practice-card-quick');
    expect(quickCta.tagName).toBe('BUTTON');
    expect(quickCta).toHaveAccessibleName(/start freestyle practice/i);
    // Headings live in the article, never inside the button.
    expect(within(cards[0]).getByRole('heading', { name: /freestyle practice/i })).toBeInTheDocument();
    expect(quickCta.querySelector('h1,h2,h3,h4')).toBeNull();
  });

  it('#1042 PR3: the Freestyle card navigates DIRECTLY to /session (no overview) and never auto-records', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    // Direct handoff to the working Session page — no intermediate overview view is rendered.
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/session');
    // The legacy full-page overview is gone: no "Open Practice Session" CTA, no journey hero, no Back path.
    expect(within(root()).queryByRole('heading', { name: /speak freely\. see how you.re progressing/i })).not.toBeInTheDocument();
    expect(within(root()).queryByRole('button', { name: /open practice session/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('practice-quick-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('practice-back-top')).not.toBeInTheDocument();
  });

  it('Guided card copy is exactly the approved marker + benefit (no preview/soon/future language)', () => {
    render(<PracticePage />);
    const card = within(root()).getAllByRole('article')[1]; // second card = Guided
    expect(within(card).getByText('Planned — not available yet')).toBeInTheDocument();
    expect(within(card).getByText('Prepare what matters. Rehearse until it lands.')).toBeInTheDocument();
    // Forbidden copy must NOT appear on the card.
    for (const banned of [/coming soon/i, /future direction/i, /preview/i, /see how it works/i]) {
      expect(within(card).queryByText(banned)).not.toBeInTheDocument();
    }
    // Status icon conveys unavailability WITHOUT color: a clock, never a checkmark (which implies ready).
    const marker = within(card).getByText('Planned — not available yet').closest('span');
    expect(marker?.querySelector('.lucide-clock')).toBeTruthy();
    expect(marker?.querySelector('.lucide-check')).toBeNull();
  });

  it('Quick card status marker reads "Available now" with a checkmark (available, no color-only cue)', () => {
    render(<PracticePage />);
    const quickCard = within(root()).getAllByRole('article')[0];
    const marker = within(quickCard).getByText('Available now').closest('span');
    expect(marker?.querySelector('.lucide-check')).toBeTruthy();
  });

  it('Guided Rehearsal is UNAVAILABLE: one contextual notice anchored to the card (not a global toast)', () => {
    render(<PracticePage />);
    const guided = screen.getByTestId('practice-card-guided');
    // BEFORE click: CTA is exactly "Guided Rehearsal", enabled; no notice yet.
    expect(guided).toHaveTextContent('Guided Rehearsal');
    expect(guided).toBeEnabled();
    expect(screen.queryByTestId('guided-unavailable-notice')).not.toBeInTheDocument();

    fireEvent.click(guided);

    // Exactly ONE contextual notice with the exact message, ANCHORED INSIDE the Guided card (article #2),
    // announced via role="status" — NOT the global top-right toast region.
    const notices = screen.getAllByTestId('guided-unavailable-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('Product not available at this time');
    expect(notices[0]).toHaveAttribute('role', 'status');
    const guidedCard = within(root()).getAllByRole('article')[1];
    expect(within(guidedCard).getByTestId('guided-unavailable-notice')).toBeInTheDocument();
    // No preview / walkthrough / correction loop; no fabricated actions; no navigation; still on chooser.
    expect(within(root()).queryByText(/preview · coming soon/i)).not.toBeInTheDocument();
    expect(within(root()).queryByText(/the correction loop/i)).not.toBeInTheDocument();
    expect(within(root()).queryByRole('button', { name: /set up a rehearsal|try a sample|see how it works/i })).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
  });

  it('after first Guided click, the Guided card ALONE becomes disabled (CTA "Unavailable", natively disabled, no arrow)', () => {
    render(<PracticePage />);
    const guidedCard = within(root()).getAllByRole('article')[1];
    const quickCard = within(root()).getAllByRole('article')[0];
    const guidedCta = screen.getByTestId('practice-card-guided');
    expect(guidedCta).toBeEnabled();
    expect(guidedCard).not.toHaveAttribute('data-disabled');

    fireEvent.click(guidedCta);

    // CTA text → "Unavailable", natively disabled, accessible name updated, card marked disabled, no arrow.
    expect(guidedCta).toHaveTextContent('Unavailable');
    expect(guidedCta).toBeDisabled();
    expect(guidedCta).toHaveAccessibleName(/guided rehearsal — unavailable/i);
    expect(guidedCta.querySelector('.lucide-arrow-right')).toBeNull();
    expect(guidedCard).toHaveAttribute('data-disabled', 'true');
    // Quick card is untouched: enabled, not disabled; no global opacity/inert/overlay on the page.
    expect(screen.getByTestId('practice-card-quick')).toBeEnabled();
    expect(quickCard).not.toHaveAttribute('data-disabled');
    expect(root()).not.toHaveAttribute('inert');
    expect(root()).not.toHaveAttribute('aria-hidden');
    expect(within(root()).queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the contextual notice renders OUTSIDE the dimmed subtree (never inherits the disabled opacity)', () => {
    render(<PracticePage />);
    const guidedCard = within(root()).getAllByRole('article')[1];
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    const notice = within(guidedCard).getByTestId('guided-unavailable-notice');
    // The card DOES have a dimmed subtree (the muted illustration + content)…
    const dimmed = guidedCard.querySelector('[data-dimmed="true"]');
    expect(dimmed).toBeTruthy();
    // …but the notice is a SIBLING of it, not a descendant — so it keeps full opacity.
    expect(dimmed?.contains(notice)).toBe(false);
    expect(notice.closest('[data-dimmed="true"]')).toBeNull();
    // Its entrance must not animate opacity (would flash sub-full-opacity): slide-in, not fade-up.
    expect(notice).toHaveClass('ss-slide-in');
    expect(notice).not.toHaveClass('ss-fade-up');
    expect(notice).toHaveClass('opacity-100');
  });

  it('a disabled Guided CTA cannot be reactivated — no second notice, no second telemetry event', () => {
    render(<PracticePage />);
    const guidedCta = screen.getByTestId('practice-card-guided');
    fireEvent.click(guidedCta); // 1st: notice + telemetry, then disabled
    fireEvent.click(guidedCta); // native-disabled → no-op
    fireEvent.keyDown(guidedCta, { key: 'Enter' });
    fireEvent.click(guidedCta);
    expect(screen.getAllByTestId('guided-unavailable-notice')).toHaveLength(1);
    expect(guidedTelemetry).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('Quick remains fully operable after Guided is disabled — navigates directly to /session', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    // Freestyle still navigates directly to /session (#1042 PR3; no overview).
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    expect(navigateSpy).toHaveBeenCalledWith('/session');
  });

  it('a fresh mount (reload) restores Guided to its initial selectable state', () => {
    const first = render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    expect(screen.getByTestId('practice-card-guided')).toBeDisabled();
    first.unmount();
    // A brand-new instance (simulating a reload / later visit) starts enabled again.
    render(<PracticePage />);
    const guided = screen.getByTestId('practice-card-guided');
    expect(guided).toBeEnabled();
    expect(guided).toHaveTextContent('Guided Rehearsal');
    expect(screen.queryByTestId('guided-unavailable-notice')).not.toBeInTheDocument();
  });

  it('#1042 PR4: returning user sees the continuity block; Review → /analytics/<id>, View analytics → /analytics', () => {
    mockHistory.mockReturnValue({
      data: [{ id: 'sess-9', created_at: '2026-07-20T00:00:00.000Z', duration: 120, status: 'completed' }],
      isLoading: false,
    } as unknown as HistoryReturn);
    render(<PracticePage />);
    expect(screen.getByTestId('practice-continuity')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('practice-continuity-review'));
    expect(navigateSpy).toHaveBeenCalledWith('/analytics/sess-9');
    fireEvent.click(screen.getByTestId('practice-continuity-analytics'));
    expect(navigateSpy).toHaveBeenCalledWith('/analytics');
  });

  it('#1042 PR4: new user sees the truthful empty state (no recent-session block)', () => {
    mockHistory.mockReturnValue({ data: [], isLoading: false } as unknown as HistoryReturn);
    render(<PracticePage />);
    expect(screen.getByTestId('practice-continuity-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-continuity')).not.toBeInTheDocument();
  });
});
