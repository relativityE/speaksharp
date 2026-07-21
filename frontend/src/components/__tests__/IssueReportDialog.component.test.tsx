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
