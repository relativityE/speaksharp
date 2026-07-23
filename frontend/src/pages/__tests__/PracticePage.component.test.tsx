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
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }),
}));
import { toast } from '@/lib/toast';
import { trackGuidedRehearsalUnavailable } from '@/services/practiceTelemetry';
const toastMock = vi.mocked(toast);
const guidedTelemetry = vi.mocked(trackGuidedRehearsalUnavailable);

// PracticePage no longer renders its own <main> — App.tsx owns the single #main-content landmark, so in
// isolation we scope queries to the page's content container instead of a main landmark.
const root = () => screen.getByTestId('practice-root');

describe('PracticePage — orientation entry (Quick → /session; Guided stays inline)', () => {
  beforeEach(() => { navigateSpy.mockReset(); toastMock.mockClear(); guidedTelemetry.mockClear(); });

  it('does NOT render a <main> landmark or #main-content (App owns the sole one)', () => {
    const { container } = render(<PracticePage />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(container.querySelector('#main-content')).toBeNull();
  });

  it('lands on the chooser: tagline, decision prompt, and both modes', () => {
    render(<PracticePage />);
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(within(root()).getByText(/do you want to speak freely, or practice toward specific outcomes/i)).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(root()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
  });

  it('each mode card is a semantic <article> with a real keyboard-operable CTA button', () => {
    render(<PracticePage />);
    const cards = within(root()).getAllByRole('article');
    expect(cards.length).toBe(2);
    // The CTA is a real <button> (keyboard-operable), not a card-as-button wrapping headings.
    const quickCta = screen.getByTestId('practice-card-quick');
    expect(quickCta.tagName).toBe('BUTTON');
    expect(quickCta).toHaveAccessibleName(/explore quick practice/i);
    // Headings live in the article, never inside the button.
    expect(within(cards[0]).getByRole('heading', { name: /quick practice/i })).toBeInTheDocument();
    expect(quickCta.querySelector('h1,h2,h3,h4')).toBeNull();
  });

  it('Quick Practice → overview → "Open Practice Session" navigates to the unchanged /session', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    // Overview appears with the specialized hero + journey.
    expect(within(root()).getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeInTheDocument();
    expect(within(root()).getByText(/choose an available transcription mode|choose your transcription mode/i)).toBeInTheDocument();
    // The final CTA reads EXACTLY "Open Practice Session" — never "Start speaking".
    expect(within(root()).getAllByRole('button', { name: /open practice session/i }).length).toBeGreaterThanOrEqual(1);
    expect(within(root()).queryByRole('button', { name: /start speaking/i })).not.toBeInTheDocument();
    // Primary action hands off to /session — and nothing else.
    fireEvent.click(screen.getByTestId('practice-quick-start'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/session');
  });

  it('Quick Overview → top Back returns to the chooser WITHOUT navigating to /session', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    expect(within(root()).getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeInTheDocument();
    // The scoped top Back control returns to the chooser — no navigation happens.
    fireEvent.click(screen.getByTestId('practice-back-top'));
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(within(root()).queryByRole('heading', { name: /speak freely\. see how you.re progressing/i })).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    // And from the returned chooser, Guided shows the unavailable toast (no navigation, no preview).
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    expect(toastMock).toHaveBeenCalledWith('Product not available at this time', { id: 'guided-unavailable' });
    expect(within(root()).queryByText(/preview · coming soon/i)).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('Quick Overview → bottom Back also returns to the chooser without navigating', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    fireEvent.click(screen.getByTestId('practice-back-bottom'));
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('Guided card copy is exactly the approved marker + description (no preview/soon/future language)', () => {
    render(<PracticePage />);
    const card = within(root()).getAllByRole('article')[1]; // second card = Guided
    expect(within(card).getByText('Planned — not available yet')).toBeInTheDocument();
    expect(within(card).getByText('Prepare key outcomes, rehearse while SpeakSharp tracks coverage, and recover missed points.')).toBeInTheDocument();
    // Forbidden copy must NOT appear on the card.
    for (const banned of [/coming soon/i, /future direction/i, /preview/i, /see how it works/i]) {
      expect(within(card).queryByText(banned)).not.toBeInTheDocument();
    }
    // Status icon conveys unavailability WITHOUT color: a clock, never a checkmark (which implies ready).
    const marker = within(card).getByText('Planned — not available yet').closest('span');
    expect(marker?.querySelector('.lucide-clock')).toBeTruthy();
    expect(marker?.querySelector('.lucide-check')).toBeNull();
  });

  it('Quick card keeps a checkmark marker (available)', () => {
    render(<PracticePage />);
    const quickCard = within(root()).getAllByRole('article')[0];
    const marker = within(quickCard).getByText('No agenda required.').closest('span');
    expect(marker?.querySelector('.lucide-check')).toBeTruthy();
  });

  it('Guided Rehearsal is UNAVAILABLE: exact toast, stays on /practice, no preview, no navigation', () => {
    render(<PracticePage />);
    const guided = screen.getByTestId('practice-card-guided');
    // BEFORE click: CTA is exactly "Guided Rehearsal", enabled and keyboard-operable.
    expect(guided).toHaveTextContent('Guided Rehearsal');
    expect(guided).toBeEnabled();
    fireEvent.click(guided);
    // Exactly ONE toast with EXACTLY the approved message (deduped by a stable id).
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('Product not available at this time', { id: 'guided-unavailable' });
    // No preview / walkthrough / correction loop; no fabricated actions; no navigation; still on chooser.
    expect(within(root()).queryByText(/preview · coming soon/i)).not.toBeInTheDocument();
    expect(within(root()).queryByText(/the correction loop/i)).not.toBeInTheDocument();
    expect(within(root()).queryByRole('button', { name: /set up a rehearsal|try a sample|see how it works/i })).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
  });

  it('after first Guided click, the Guided card ALONE becomes disabled (CTA "Unavailable", natively disabled)', () => {
    render(<PracticePage />);
    const guidedCard = within(root()).getAllByRole('article')[1];
    const quickCard = within(root()).getAllByRole('article')[0];
    const guidedCta = screen.getByTestId('practice-card-guided');
    // Before: enabled, "Guided Rehearsal", card not marked disabled.
    expect(guidedCta).toBeEnabled();
    expect(guidedCard).not.toHaveAttribute('data-disabled');

    fireEvent.click(guidedCta);

    // CTA text → "Unavailable", natively disabled, accessible name updated, card marked disabled.
    expect(guidedCta).toHaveTextContent('Unavailable');
    expect(guidedCta).toBeDisabled();
    expect(guidedCta).toHaveAccessibleName(/guided rehearsal — unavailable/i);
    expect(guidedCard).toHaveAttribute('data-disabled', 'true');
    // Quick card is untouched: enabled, not disabled, no global opacity/inert on the page.
    expect(screen.getByTestId('practice-card-quick')).toBeEnabled();
    expect(quickCard).not.toHaveAttribute('data-disabled');
    expect(root()).not.toHaveAttribute('inert');
    expect(root()).not.toHaveAttribute('aria-hidden');
    // No full-page overlay/backdrop/focus-trap.
    expect(within(root()).queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a disabled Guided CTA cannot be reactivated — no second toast, no second telemetry event', () => {
    render(<PracticePage />);
    const guidedCta = screen.getByTestId('practice-card-guided');
    fireEvent.click(guidedCta); // 1st: toast + telemetry, then disabled
    fireEvent.click(guidedCta); // native-disabled → no-op
    fireEvent.keyDown(guidedCta, { key: 'Enter' });
    fireEvent.click(guidedCta);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(guidedTelemetry).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('the disabled Guided state survives a Quick → back round-trip within the visit', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-guided')); // acknowledge → disabled
    expect(screen.getByTestId('practice-card-guided')).toBeDisabled();
    // Go into Quick overview and back to the chooser.
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    fireEvent.click(screen.getByTestId('practice-back-top'));
    // Guided remains disabled (local state retained); no extra toast was shown.
    expect(screen.getByTestId('practice-card-guided')).toBeDisabled();
    expect(screen.getByTestId('practice-card-guided')).toHaveTextContent('Unavailable');
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
