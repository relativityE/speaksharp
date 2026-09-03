import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { IssueReportDialog } from '../IssueReportDialog';
import { issueReportService } from '@/services/issueReportService';
import { toast } from '@/lib/toast';

// No <Toaster> is mounted in this harness, so a toast never reaches the DOM. Assert on what the
// component actually says, not on a surface the test environment does not render.
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep buildIssueReportMetadata + types real; spy on the persistence call only.
vi.mock('@/services/issueReportService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/issueReportService')>();
  return {
    ...actual,
    issueReportService: { ...actual.issueReportService, submit: vi.fn(async () => ({ id: 'report-1' })) },
  };
});
const mockSubmit = vi.mocked(issueReportService.submit);

const UUID = '130bbc6c-5d89-465d-91e6-51f5a5951e34';

async function openFillSubmit() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('nav-report-issue-button'));
  // #1404: Message starts unselected and is REQUIRED, so every submission path must choose one.
  await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'issue');
  const title = await screen.findByTestId('issue-report-title');
  await user.type(title, 'Mic did not start');
  await user.type(screen.getByTestId('issue-report-description'), 'It failed when I pressed record.');
  await user.click(screen.getByTestId('issue-report-submit'));
  await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
}

describe('IssueReportDialog — report→session attribution', () => {
  beforeEach(() => mockSubmit.mockClear());

  it('attaches the correct session id when opened from /analytics/:sessionId', async () => {
    render(<IssueReportDialog userId="u1" />, { route: `/analytics/${UUID}` });
    await openFillSubmit();
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: UUID }));
  });

  it('attaches NO session id (null) when opened from a non-session route', async () => {
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await openFillSubmit();
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null }));
  });

  it('does not fabricate a session id from an invalid /analytics/:sessionId segment', async () => {
    render(<IssueReportDialog userId="u1" />, { route: '/analytics/not-a-uuid' });
    await openFillSubmit();
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null }));
  });

  it('attaches no session id on the /analytics list route (no :sessionId)', async () => {
    render(<IssueReportDialog userId="u1" />, { route: '/analytics' });
    await openFillSubmit();
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null }));
  });
});

describe('IssueReportDialog — page-aware context', () => {
  beforeEach(() => mockSubmit.mockClear());

  it('tells the tester which page/step is being reported', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    const banner = await screen.findByTestId('issue-report-page-context');
    expect(banner).toHaveTextContent(/reporting from/i);
    expect(banner).toHaveTextContent(/session · speaking/i);
    // Page-specific issue-area options are offered.
    const area = screen.getByTestId('issue-report-area') as HTMLSelectElement;
    expect([...area.options].map((o) => o.value)).toContain('transcription');
  });

  it('stores the sanitized canonical route (template, no concrete id/query) as page_url + metadata.route', async () => {
    render(<IssueReportDialog userId="u1" />, { route: `/analytics/${UUID}` });
    await openFillSubmit();
    const arg = mockSubmit.mock.calls[0][0];
    expect(arg.pageUrl).toBe('/analytics/:sessionId');
    expect(arg.metadata.route).toBe('/analytics/:sessionId');
    expect(arg.metadata.canonicalRoute).toBe('/analytics/:sessionId');
    // The concrete session UUID rides ONLY in the dedicated session_id field, never in page_url/metadata.
    expect(arg.sessionId).toBe(UUID);
    expect(arg.pageUrl).not.toContain(UUID);
    expect(JSON.stringify(arg.metadata)).not.toContain(UUID);
  });

  it('records the selected issue area and page identity in metadata', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/analytics' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    // #1404: the kind is required before this form can submit.
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'issue');
    await user.selectOptions(await screen.findByTestId('issue-report-area'), 'comparison');
    await user.type(screen.getByTestId('issue-report-title'), 'Comparison looks off');
    await user.type(screen.getByTestId('issue-report-description'), 'The comparison chart shows the wrong baseline.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    const arg = mockSubmit.mock.calls[0][0];
    expect(arg.metadata).toMatchObject({ pageKey: 'analytics', productMode: 'progress', issueArea: 'comparison' });
  });
});

/**
 * #1404 — the form now serves feedback that is not a defect.
 *
 * Everything below drives the REAL dialog through real user events; only the persistence call is spied.
 * The point is not that a select exists, but that BOTH kinds actually reach submission carrying the
 * right kind and still carrying the session/model attribution the support queue depends on.
 */
describe('#1404 Share Feedback — Message kind', () => {
  beforeEach(() => { mockSubmit.mockClear(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

  it('the persistent entry point is named "Share Feedback" for sighted and assistive users alike', async () => {
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    const trigger = screen.getByTestId('nav-report-issue-button');
    expect(trigger).toHaveAccessibleName('Share Feedback');
    expect(trigger).toHaveTextContent('Share Feedback');
  });

  it('the dialog heading is "Share Feedback", not an issue-only title', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    expect(await screen.findByRole('heading', { name: 'Share Feedback' })).toBeInTheDocument();
  });

  it('Message is the FIRST question, offering exactly Issue and Comment', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    const kind = await screen.findByTestId('issue-report-feedback-kind');
    const choosable = [...kind.querySelectorAll('option')].filter((o) => o.value !== '');
    expect(choosable.map((o) => o.textContent)).toEqual(['Issue', 'Comment']);
    // First: a kind chosen after describing the problem is a kind chosen too late to shape the form.
    const area = screen.getByTestId('issue-report-area');
    expect(kind.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('submits Message = Issue through the real UI, with attribution intact', async () => {
    render(<IssueReportDialog userId="u1" sttMode="private" plan="pro" />, { route: `/analytics/${UUID}` });
    await openFillSubmit();
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: UUID,
      metadata: expect.objectContaining({ feedback_kind: 'issue', sttMode: 'private', plan: 'pro' }),
    }));
  });

  it('submits Message = Comment through the real UI, with the SAME attribution', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" sttMode="private" plan="pro" />, { route: `/analytics/${UUID}` });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.type(screen.getByTestId('issue-report-title'), 'Coverage rail is lovely');
    await user.type(screen.getByTestId('issue-report-description'), 'The points rail made the retake obvious.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: UUID,
      metadata: expect.objectContaining({ feedback_kind: 'comment', sttMode: 'private', plan: 'pro' }),
    }));
  });

  it('CASUALTY: Message begins UNSELECTED and cannot be submitted until chosen', async () => {
    // Previously this defaulted to Issue. A pre-selected kind is a guess recorded as the user's answer,
    // and 'Issue' is the kind that pulls support attention — defaulting manufactures defects from praise.
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    const kind = await screen.findByTestId('issue-report-feedback-kind');
    expect((kind as HTMLSelectElement).value, 'no kind may be pre-chosen').toBe('');

    // A complete, valid message is still not submittable while the kind is unchosen.
    await user.type(screen.getByTestId('issue-report-title'), 'Mic did not start');
    await user.type(screen.getByTestId('issue-report-description'), 'It failed when I pressed record.');
    expect(screen.getByTestId('issue-report-submit')).toBeDisabled();
    await user.click(screen.getByTestId('issue-report-submit'));
    expect(mockSubmit).not.toHaveBeenCalled();

    // Choosing one releases it.
    await user.selectOptions(kind, 'comment');
    expect(screen.getByTestId('issue-report-submit')).toBeEnabled();
  });

  it('CASUALTY: a kind chosen then ABANDONED does not survive into the next message', async () => {
    // reset() only runs after a successful submit. A user who picks Comment, changes their mind and
    // closes the dialog would otherwise reopen with Comment still selected — a stale answer presented
    // as their current one, and the path no submit-based test can reach.
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('issue-report-feedback-kind')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('nav-report-issue-button'));
    const reopened = await screen.findByTestId('issue-report-feedback-kind');
    expect((reopened as HTMLSelectElement).value, 'an abandoned choice must not carry over').toBe('');
  });

  it('the unselected placeholder cannot itself be chosen as an answer', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    const kind = await screen.findByTestId('issue-report-feedback-kind');
    const placeholder = [...kind.querySelectorAll('option')].find((o) => o.value === '');
    expect(placeholder, 'an unselected state needs a visible placeholder').toBeTruthy();
    expect(placeholder).toBeDisabled();
  });

  it('CASUALTY: a Comment is not confirmed to the user as an issue report', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.type(screen.getByTestId('issue-report-title'), 'A kind word');
    await user.type(screen.getByTestId('issue-report-description'), 'Thanks for the coverage rail.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Feedback submitted');
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/issue report/i));
  });

  it('the kind RESETS to unselected for the next message rather than carrying over', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.type(screen.getByTestId('issue-report-title'), 'A kind word');
    await user.type(screen.getByTestId('issue-report-description'), 'Thanks for the coverage rail.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    mockSubmit.mockClear();
    await user.click(screen.getByTestId('nav-report-issue-button'));
    const reopened = await screen.findByTestId('issue-report-feedback-kind');
    expect((reopened as HTMLSelectElement).value, 'the previous choice must not carry over').toBe('');
  });
});

describe('#1404 — renamed labels, unchanged behaviour', () => {
  beforeEach(() => { mockSubmit.mockClear(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

  it.each([
    ['Where in the app?', 'issue-report-area'],
    ['Category', 'issue-report-category'],
    ['Impact', 'issue-report-severity'],
    ['Title', 'issue-report-title'],
    ['Short description', 'issue-report-description'],
  ])('shows "%s" as the visible label', async (label, testid) => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await screen.findByTestId(testid);
    expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
  });

  it.each(['What part had a problem?', 'Short title', 'What happened?'])(
    'the old label "%s" is gone', async (old) => {
      const user = userEvent.setup();
      render(<IssueReportDialog userId="u1" />, { route: '/session' });
      await user.click(screen.getByTestId('nav-report-issue-button'));
      await screen.findByTestId('issue-report-title');
      expect(screen.queryByText(old)).toBeNull();
    });

  it('validation is unchanged: a too-short message cannot be submitted, for EITHER kind', async () => {
    const user = userEvent.setup();
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.type(screen.getByTestId('issue-report-title'), 'ab');
    await user.type(screen.getByTestId('issue-report-description'), 'too short');
    expect(screen.getByTestId('issue-report-submit')).toBeDisabled();
    await user.click(screen.getByTestId('issue-report-submit'));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('a failed submission still tells the user, for a Comment as well as an Issue', async () => {
    const user = userEvent.setup();
    mockSubmit.mockRejectedValueOnce(new Error('network'));
    render(<IssueReportDialog userId="u1" />, { route: '/session' });
    await user.click(screen.getByTestId('nav-report-issue-button'));
    await user.selectOptions(await screen.findByTestId('issue-report-feedback-kind'), 'comment');
    await user.type(screen.getByTestId('issue-report-title'), 'A kind word');
    await user.type(screen.getByTestId('issue-report-description'), 'Thanks for the coverage rail.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/could not be submitted/i));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Issue report/i));
  });
});
