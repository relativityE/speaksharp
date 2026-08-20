import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { IssueReportDialog } from '../IssueReportDialog';
import { issueReportService } from '@/services/issueReportService';

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
    await user.selectOptions(await screen.findByTestId('issue-report-area'), 'comparison');
    await user.type(screen.getByTestId('issue-report-title'), 'Comparison looks off');
    await user.type(screen.getByTestId('issue-report-description'), 'The comparison chart shows the wrong baseline.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    const arg = mockSubmit.mock.calls[0][0];
    expect(arg.metadata).toMatchObject({ pageKey: 'analytics', productMode: 'progress', issueArea: 'comparison' });
  });
});
