import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PracticePage from '@/pages/PracticePage';
import { IssueReportDialog } from '@/components/IssueReportDialog';
import { PracticeSurfaceProvider } from '@/components/practice/PracticeSurfaceContext';
import { issueReportService } from '@/services/issueReportService';
import { toast } from '@/lib/toast';

// Keep buildIssueReportMetadata REAL (so we assert the true stored context); mock only the network submit.
vi.mock('@/services/issueReportService', async (orig) => {
  const actual = await orig<typeof import('@/services/issueReportService')>();
  return { ...actual, issueReportService: { submit: vi.fn().mockResolvedValue({ id: 'rep_1' }) } };
});
vi.mock('@/services/practiceTelemetry', () => ({
  trackPracticeEntryViewed: vi.fn(), trackPracticeModeSelected: vi.fn(), trackPracticeOverviewExpanded: vi.fn(),
  trackFreeformPracticeStarted: vi.fn(),
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

async function openReport() {
  fireEvent.click(screen.getByTestId('nav-report-issue-button'));
  await screen.findByTestId('issue-report-description');
}

// Open → assert visible label + areas → fill → submit; returns the captured metadata.
async function reportAndCapture(expectedLabel: RegExp, _expectedAreas: string[]) {
  await openReport();
  expect(banner()).toHaveTextContent(expectedLabel);
  fireEvent.click(screen.getByTestId('feedback-type-broke'));
  fireEvent.change(screen.getByTestId('issue-report-description'), { target: { value: 'A description with enough length.' } });
  fireEvent.click(screen.getByTestId('issue-report-submit'));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  const calls = submit.mock.calls;
  const meta = calls[calls.length - 1][0].metadata;
  await waitFor(() => expect(screen.queryByTestId('issue-report-description')).not.toBeInTheDocument());
  return meta;
}

// #1042 PR3: the full-page overview + its `freeform_practice_overview` surface were removed. #1046 slice 5b
// then ACTIVATED Focus Points, so /practice no longer has an "Objective-unavailable" surface: the Freeform
// card navigates directly to /session, and the Focus Points card opens the capture dialog (no surface mark).
describe('Report Issue — /practice surface attribution (chooser surface)', () => {
  beforeEach(() => submit.mockClear());

  it('practice_home (chooser): shows SpeakSharp Practice + home areas, stores practice_home', async () => {
    renderApp();
    const meta = await reportAndCapture(/SpeakSharp Practice/, ['understanding_choices', 'navigation', 'visual_layout', 'other']);
    expect(meta).toMatchObject({ practiceSurface: 'practice_home', journeyStep: 'chooser', canonicalRoute: '/practice', pageKey: 'practice' });
  });

  it('#1042 PR3: the Freeform card navigates DIRECTLY to /session; a report there uses the Session · Speaking context', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-freeform')); // navigate('/session') → PracticePage unmounts (no overview)
    expect(await screen.findByTestId('session-marker')).toBeInTheDocument();
    await openReport();
    expect(banner()).toHaveTextContent(/Session · Speaking/);
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

/**
 * #1404 user-journey evidence — BOTH products, BOTH message kinds, through the real UI.
 *
 * The unit tests prove the select works. These prove the thing the PO actually cares about: that a user
 * inside each product can reach Share Feedback, send the kind they mean, be told it worked, and have the
 * message land attributed to the product and session they were in. A kind that submits but loses its
 * product attribution is useless to the support queue.
 */
describe('#1404 Share Feedback — user journey across both products', () => {
  beforeEach(() => {
    submit.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  async function shareFeedback(kind: 'issue' | 'comment', _title: string, body: string) {
    fireEvent.click(screen.getByTestId('nav-report-issue-button'));
    await screen.findByTestId('issue-report-description');
    fireEvent.click(screen.getByTestId(kind === 'issue' ? 'feedback-type-broke' : 'feedback-type-praise'));
    fireEvent.change(screen.getByTestId('issue-report-description'), { target: { value: body } });
    fireEvent.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    return submit.mock.calls[submit.mock.calls.length - 1][0];
  }

  it('PRODUCT 1 — Open Mic: a user submits an ISSUE and is told it was sent', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-freeform'));
    expect(await screen.findByTestId('session-marker')).toBeInTheDocument();

    const arg = await shareFeedback('issue', 'Mic did not start', 'I pressed record and nothing happened.');

    expect(arg.metadata).toMatchObject({ feedback_kind: 'issue' });
    // Attributed to the product the user was actually in.
    expect(arg.metadata.pageKey).toBe('session');
    expect(arg.metadata.canonicalRoute).toBe('/session');
    // The user gets confirmation, and it does not misname their message.
    expect(toast.success).toHaveBeenCalledWith('Thanks — we’ve got it.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('PRODUCT 2 — Focus Points: a user submits a COMMENT and is told it was sent', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-objective'));

    const arg = await shareFeedback('comment', 'The points rail is clear', 'Seeing which points I missed made the retake obvious.');

    expect(arg.metadata).toMatchObject({ feedback_kind: 'comment' });
    // Focus Points is its own surface: a comment from here must not be attributed to Open Mic.
    expect(arg.metadata.practiceSurface).toBe('objective_setup');
    expect(arg.metadata.productMode).not.toBe('freeform');
    expect(toast.success).toHaveBeenCalledWith('Thanks — we’ve got it.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('the two products stay ISOLATED: each message carries its own surface, not the previous one', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-objective'));
    const fromObjective = await shareFeedback('comment', 'Focus Points note', 'A comment from the Focus Points surface.');
    const objectiveSurface = fromObjective.metadata.practiceSurface;

    submit.mockClear();
    fireEvent.click(screen.getByTestId('practice-card-freeform'));
    expect(await screen.findByTestId('session-marker')).toBeInTheDocument();
    const fromOpenMic = await shareFeedback('issue', 'Open Mic note', 'An issue from the Open Mic session.');

    expect(fromOpenMic.metadata.practiceSurface).not.toBe(objectiveSurface);
    expect(fromOpenMic.metadata.feedback_kind).toBe('issue');
  });

  it('a failed submission still tells the user, inside a product journey', async () => {
    renderApp();
    fireEvent.click(screen.getByTestId('practice-card-objective'));
    submit.mockRejectedValueOnce(new Error('network'));
    await shareFeedback('comment', 'Focus Points note', 'A comment that will fail to send.');
    expect(await screen.findByRole('alert')).toHaveTextContent('That didn’t go through. Try again?');
  });
});
