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
  trackGuidedRehearsalPreviewViewed: vi.fn(),
}));

// PracticePage no longer renders its own <main> — App.tsx owns the single #main-content landmark, so in
// isolation we scope queries to the page's content container instead of a main landmark.
const root = () => screen.getByTestId('practice-root');

describe('PracticePage — orientation entry (Quick → /session; Guided stays inline)', () => {
  beforeEach(() => navigateSpy.mockReset());

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

  it('Quick Practice → overview (5-step) → "Start speaking" navigates to the unchanged /session', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    // Overview appears with the specialized hero + journey.
    expect(within(root()).getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeInTheDocument();
    expect(within(root()).getByText(/choose your transcription mode/i)).toBeInTheDocument();
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
    // And from the returned chooser, Guided still opens inline (no reload / no navigation).
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    expect(within(root()).getByText(/preview · coming soon/i)).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('Quick Overview → bottom Back also returns to the chooser without navigating', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    fireEvent.click(screen.getByTestId('practice-back-bottom'));
    expect(within(root()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('Guided Rehearsal stays on the page: expands an inline PREVIEW and never navigates', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    // Stays put — an inline preview appears, clearly labelled as not-yet-available.
    expect(within(root()).getByRole('heading', { name: /prepare what matters\. rehearse until it lands/i })).toBeInTheDocument();
    expect(within(root()).getByText(/preview · coming soon/i)).toBeInTheDocument();
    expect(within(root()).getByText(/the correction loop/i)).toBeInTheDocument();
    // No fake "Set up a rehearsal" action, and no navigation.
    expect(within(root()).queryByRole('button', { name: /set up a rehearsal/i })).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    // Collapses again on toggle.
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    expect(within(root()).queryByText(/preview · coming soon/i)).not.toBeInTheDocument();
  });
});
