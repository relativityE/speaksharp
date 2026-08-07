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
  trackFreeformPracticeStarted: vi.fn(), trackObjectiveUnavailable: vi.fn(),
}));
// #1042 PR4: PracticePage reads the most-recent session via useRecentPracticeSummary; mock it (new user /
// no sessions) so this integration test needs no QueryClient/Auth provider and the surface flow is unchanged.
vi.mock('@/hooks/useRecentPracticeSummary', () => ({ useRecentPracticeSummary: () => ({ data: [], isLoading: false }) }));
// #1047: Home also reads the persisted streak from the cached check-usage-limit query; this suite
// renders without a QueryClientProvider, and the streak is irrelevant to surface attribution.
vi.mock('@/hooks/useUsageLimit', () => ({ useUsageLimit: () => ({ data: undefined }) }));
// #1061: PracticePage is now auth-aware; this suite exercises the AUTHENTICATED /practice reporting surface
// (Freeform → /session directly), so mock an authenticated user.
vi.mock('@/contexts/AuthProvider', async (orig) => {
  const actual = await orig<typeof import('@/contexts/AuthProvider')>();
  return { ...actual, useAuthProvider: () => ({ user: { id: 'u-1' } }) };
});
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }),
}));
// Report persistence must be INDEPENDENT of the analytics transport: make AnalyticsBuffer.push throw and
// prove a report still persists (the Report Issue submit path never touches telemetry).
vi.mock('@/services/AnalyticsBuffer', () => ({
  analyticsBuffer: { push: vi.fn(() => { throw new Error('analytics transport down'); }), identify: vi.fn() },
}));

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

// #1042 PR3: the full-page overview + its `freeform_practice_overview` surface were removed — /practice now
// has TWO surfaces (chooser + Objective-unavailable), and the Freeform card navigates directly to /session.
describe('Report Issue — /practice surface attribution (one route, two surfaces)', () => {
  beforeEach(() => submit.mockClear());

  it('practice_home (chooser): shows SpeakSharp Practice + home areas, stores practice_home', async () => {
    renderApp();
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta).toMatchObject({ practiceSurface: 'practice_home', journeyStep: 'chooser', canonicalRoute: '/practice', pageKey: 'practice' });
  });

  it('objective: internal token objective_unavailable but VISIBLE label exactly "Focus Points"', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-objective')); // shows toast + marks surface (no preview)
    await openReport();
    // Visible label is exactly "Focus Points" — never "(unavailable)".
    expect(banner()).toHaveTextContent(/Reporting from:\s*Focus Points/);
    expect(banner()).not.toHaveTextContent(/unavailable/i);
    expect(areaValues()).toEqual(['availability', 'product_clarity', 'navigation', 'visual_layout', 'other']);
    fireEvent.change(screen.getByTestId('issue-report-title'), { target: { value: 'A clear title' } });
    fireEvent.change(screen.getByTestId('issue-report-description'), { target: { value: 'A description with enough length.' } });
    fireEvent.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const calls = submit.mock.calls;
    const meta = calls[calls.length - 1][0].metadata;
    // Internal token still records unavailability for triage.
    expect(meta).toMatchObject({ practiceSurface: 'objective_unavailable', pageLabel: 'Focus Points', journeyStep: 'objective_unavailable', canonicalRoute: '/practice' });
  });

  it('objective attribution PERSISTS after the toast (a report on the chooser attributes to Objective)', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-objective'));
    // Still on the chooser (no preview); a report opened now attributes to Objective.
    const first = await reportAndCapture(/Focus Points/, ['availability', 'product_clarity', 'navigation', 'visual_layout', 'other']);
    expect(first.practiceSurface).toBe('objective_unavailable');
  });

  it('#1042 PR3: the Freeform card navigates DIRECTLY to /session; a report there uses the Session · Speaking context', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-freeform')); // navigate('/session') → PracticePage unmounts (no overview)
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
