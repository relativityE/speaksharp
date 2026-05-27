import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import { OpsStatusPage } from '../OpsStatusPage';

const livePayload = {
  generatedAt: '2026-05-27T14:30:00.000Z',
  baseUrl: 'https://speaksharp-public.vercel.app',
  repo: 'relativityE/speaksharp',
  runContext: 'GitHub Actions',
  durationMs: 123,
  summary: { pass: 1, warn: 1, fail: 0, skip: 0 },
  verdict: 'NO HARD FAILURES',
  checks: [
    {
      name: 'App',
      status: 'pass',
      label: 'OK',
      icon: '🟢',
      question: 'Can users reach SpeakSharp?',
      evidence: 'Production app HTTP 200',
      nextAction: 'No action.',
      latencyMs: 42,
      checkedAt: '2026-05-27T14:30:00.000Z',
      drilldownUrl: 'https://speaksharp-public.vercel.app',
    },
    {
      name: 'GitHub API',
      status: 'warn',
      label: 'REVIEW',
      icon: '🟡',
      question: 'Can we query repository metadata and release workflows?',
      evidence: 'rc=in_progress',
      nextAction: 'Open Actions and fix red release workflows.',
      latencyMs: 81,
      checkedAt: '2026-05-27T14:30:00.000Z',
      drilldownUrl: 'https://github.com/relativityE/speaksharp/actions',
    },
  ],
};

const fallbackPayload = {
  ...livePayload,
  runContext: 'static fallback',
  verdict: 'STATIC FALLBACK ONLY',
  summary: { pass: 0, warn: 0, fail: 0, skip: 1 },
  checks: [
    {
      ...livePayload.checks[0],
      status: 'skip',
      label: 'NOT READY',
      icon: '🚧',
      evidence: 'GitHub Ops Health has not published a fresh result yet.',
    },
  ],
};

const jsonResponse = (body: unknown) => ({
  ok: true,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: async () => JSON.stringify(body),
});

const htmlResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'text/html' }),
  text: async () => '<!doctype html><html></html>',
});

describe('OpsStatusPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(livePayload) as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders software API status from the GitHub-published summary', async () => {
    render(<OpsStatusPage />, { route: '/admin/ops-status', path: '/admin/ops-status' });

    expect(await screen.findByText('Software API Status')).toBeInTheDocument();
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('NO HARD FAILURES');
    expect(screen.getByText('App')).toBeInTheDocument();
    expect(screen.getByText('Production app HTTP 200')).toBeInTheDocument();
    expect(screen.getByText('GitHub API')).toBeInTheDocument();
    expect(screen.getByText('rc=in_progress')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('ops-health.summary.json'), { cache: 'no-store' });
  });

  it('falls back to static summary JSON when the live endpoint is unavailable', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(htmlResponse() as Response)
      .mockResolvedValueOnce(jsonResponse(fallbackPayload) as Response);

    render(<OpsStatusPage />, { route: '/admin/ops-status', path: '/admin/ops-status' });

    await waitFor(() => {
      expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('STATIC FALLBACK ONLY');
    });
    expect(screen.getByText('GitHub Ops Health has not published a fresh result yet.')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('ops-health.summary.json'), { cache: 'no-store' });
  });
});
