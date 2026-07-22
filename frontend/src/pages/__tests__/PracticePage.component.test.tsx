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

const main = () => screen.getByRole('main');

describe('PracticePage — orientation entry (Quick → /session; Guided stays inline)', () => {
  beforeEach(() => navigateSpy.mockReset());

  it('lands on the chooser: tagline, decision prompt, and both modes', () => {
    render(<PracticePage />);
    expect(within(main()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(within(main()).getByText(/do you want to speak freely, or practice toward specific outcomes/i)).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
  });

  it('Quick Practice → overview (5-step) → "Start speaking" navigates to the unchanged /session', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    // Overview appears with the specialized hero + journey.
    expect(within(main()).getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeInTheDocument();
    expect(within(main()).getByText(/choose your transcription mode/i)).toBeInTheDocument();
    // Primary action hands off to /session — and nothing else.
    fireEvent.click(screen.getByTestId('practice-quick-start'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/session');
  });

  it('Guided Rehearsal stays on the page: expands an inline PREVIEW and never navigates', () => {
    render(<PracticePage />);
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    // Stays put — an inline preview appears, clearly labelled as not-yet-available.
    expect(within(main()).getByRole('heading', { name: /prepare what matters\. rehearse until it lands/i })).toBeInTheDocument();
    expect(within(main()).getByText(/preview · coming soon/i)).toBeInTheDocument();
    expect(within(main()).getByText(/the correction loop/i)).toBeInTheDocument();
    // No fake "Set up a rehearsal" action, and no navigation.
    expect(within(main()).queryByRole('button', { name: /set up a rehearsal/i })).not.toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    // Collapses again on toggle.
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    expect(within(main()).queryByText(/preview · coming soon/i)).not.toBeInTheDocument();
  });
});
