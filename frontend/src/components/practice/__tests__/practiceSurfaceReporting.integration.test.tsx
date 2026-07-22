import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PracticePage from '@/pages/PracticePage';
import { IssueReportDialog } from '@/components/IssueReportDialog';
import { PracticeSurfaceProvider } from '@/components/practice/PracticeSurfaceContext';
import { issueReportService } from '@/services/issueReportService';

// Keep buildIssueReportMetadata REAL (so we assert the true stored context); mock only the network submit.
vi.mock('@/services/issueReportService', async (orig) => {
  const actual = await orig<typeof import('@/services/issueReportService')>();
  return { ...actual, issueReportService: { submit: vi.fn().mockResolvedValue({ id: 'rep_1' }) } };
});
vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(), trackPracticeModeSelected: vi.fn(), trackPracticeOverviewExpanded: vi.fn(),
  trackQuickPracticeStarted: vi.fn(), trackGuidedRehearsalPreviewViewed: vi.fn(),
}));
// Report persistence must be INDEPENDENT of the analytics transport: make AnalyticsBuffer.push throw and
// prove a report still persists (the Report Issue submit path never touches telemetry).
vi.mock('@/services/AnalyticsBuffer', () => ({
  analyticsBuffer: { push: vi.fn(() => { throw new Error('analytics transport down'); }), identify: vi.fn() },
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const submit = vi.mocked(issueReportService.submit);

function renderApp(initial = '/practice') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PracticeSurfaceProvider>
        {/* Dialog lives OUTSIDE the routed content, like the global header does. */}
        <IssueReportDialog userId="user-1" />
        <Routes>
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/session" element={<div data-testid="session-marker">SESSION</div>} />
        </Routes>
      </PracticeSurfaceProvider>
    </MemoryRouter>,
  );
}

const banner = () => screen.getByTestId('issue-report-page-context');
const areaValues = () =>
  within(screen.getByTestId('issue-report-area')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

async function openReport() {
  fireEvent.click(screen.getByTestId('nav-report-issue-button'));
  await screen.findByTestId('issue-report-title');
}

// Open → assert visible label + areas → fill → submit; returns the captured metadata.
async function reportAndCapture(expectedLabel: RegExp, expectedAreas: string[]) {
  await openReport();
  expect(banner()).toHaveTextContent(expectedLabel);
  expect(areaValues()).toEqual(expectedAreas);
  fireEvent.change(screen.getByTestId('issue-report-title'), { target: { value: 'A clear title' } });
  fireEvent.change(screen.getByTestId('issue-report-description'), { target: { value: 'A description with enough length.' } });
  fireEvent.click(screen.getByTestId('issue-report-submit'));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const calls = submit.mock.calls;
  const meta = calls[calls.length - 1][0].metadata;
  await waitFor(() => expect(screen.queryByTestId('issue-report-title')).not.toBeInTheDocument());
  return meta;
}

describe('Report Issue — /practice surface attribution (one route, three surfaces)', () => {
  beforeEach(() => submit.mockClear());

  it('practice_home (chooser): shows SpeakSharp Practice + home areas, stores practice_home', async () => {
    renderApp();
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta).toMatchObject({ practiceSurface: 'practice_home', journeyStep: 'chooser', canonicalRoute: '/practice', pageKey: 'practice' });
  });

  it('quick_practice_overview: shows Quick Practice overview + quick areas, stores quick surface', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    const meta = await reportAndCapture(/Quick Practice overview/, ['walkthrough', 'start_speaking', 'navigation', 'visual_layout', 'other']);
    expect(meta).toMatchObject({ practiceSurface: 'quick_practice_overview', journeyStep: 'quick_overview', canonicalRoute: '/practice' });
  });

  it('Back to chooser returns context to practice_home', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    fireEvent.click(screen.getByTestId('practice-back-top'));
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta.practiceSurface).toBe('practice_home');
  });

  it('guided_rehearsal_preview (expanded): shows Guided Rehearsal preview + guided areas', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-guided'));
    const meta = await reportAndCapture(/Guided Rehearsal preview/, ['walkthrough', 'correction_loop', 'feature_clarity', 'visual_layout', 'other']);
    expect(meta).toMatchObject({ practiceSurface: 'guided_rehearsal_preview', journeyStep: 'guided_preview', canonicalRoute: '/practice' });
  });

  it('guided preview closed returns context to practice_home', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-guided')); // open
    fireEvent.click(screen.getByTestId('practice-card-guided')); // close
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta.practiceSurface).toBe('practice_home');
  });

  it('Quick "Start speaking" → /session, and a report there uses the Session · Speaking context (surface reset)', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-quick'));
    fireEvent.click(screen.getByTestId('practice-quick-start')); // navigate('/session') → PracticePage unmounts
    expect(await screen.findByTestId('session-marker')).toBeInTheDocument();
    await openReport();
    expect(banner()).toHaveTextContent(/Session · Speaking/);
    expect(areaValues()).toContain('transcription');
  });

  it('report persistence succeeds even when the analytics transport throws (persistence ⟂ telemetry)', async () => {
    // AnalyticsBuffer.push throws (mocked above); the Report Issue submit path does not touch it, so the
    // report still persists.
    renderApp();
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta.practiceSurface).toBe('practice_home');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
