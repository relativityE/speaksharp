import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '../../../tests/support/test-utils';
import { OpsStatusPage } from '../OpsStatusPage';

const now = new Date(Date.now() - 60_000).toISOString();
const actions = 'https://github.com/relativityE/speaksharp/actions';
const app = { name: 'App', status: 'pass', evidence: 'Production app HTTP 200', checkedAt: now,
  drilldownUrl: 'https://speaksharp-public.vercel.app' };
const git = { name: 'GitHub API', status: 'fail', evidence: 'repo=relativityE/speaksharp; private=false; ci=failure',
  checkedAt: now, drilldownUrl: actions, github: {
    repository: 'pass', actions: 'pass', repositoryUrl: 'https://github.com/relativityE/speaksharp', actionsUrl: actions,
    workflows: [
      { kind: 'ci', outcome: 'failed', url: actions + '/runs/381', branch: 'main', runAt: now },
      { kind: 'canary', outcome: 'passed', url: actions + '/runs/382', branch: 'other', runAt: now },
      { kind: 'release', outcome: 'missing', url: actions + '/workflows/rc-gates.yml', runAt: null },
    ],
  } };
const payload = {
  generatedAt: now,
  runContext: 'GitHub Actions',
  summary: { pass: 2, warn: 0, fail: 1, skip: 0 },
  checks: [app, git, { name: 'Gemini API', status: 'pass', evidence: 'models=200', checkedAt: now }],
};
const jsonResponse = (body: unknown) => ({
  ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body),
});
const htmlResponse = () => ({
  ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<!doctype html><html></html>',
});
const summaryEndpoint = "https://test.supabase.co/storage/v1/object/public/ops-health/ops-health.summary.json";
const view = () => render(<OpsStatusPage summaryEndpoint={summaryEndpoint} />, { route: '/admin/ops-status', path: '/admin/ops-status' });
function service(name: string): HTMLDetailsElement {
  const row = screen.getByText(name, { exact: true }).closest('details');
  if (!row) throw Error('Service row not rendered: ' + name);
  return row;
}

describe('OpsStatusPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload) as Response);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses one compact collapsed row per service, with scope and a real link in its drill-down', async () => {
    view();
    await screen.findByText('The production page responded');
    expect(screen.getByRole('heading', { name: 'Software health' })).toBeInTheDocument();
    expect(screen.getByText(/Latest published report/)).toBeInTheDocument();
    expect(screen.getByTestId('ops-status-checks').querySelectorAll('details')).toHaveLength(3);
    const row = service('SpeakSharp');
    expect(row.open).toBe(false);
    expect(row.querySelector('summary')).toHaveTextContent('Working');
    fireEvent.click(row.querySelector('summary')!);
    expect(row.open).toBe(true);
    expect(within(row).getByText('Does not run sign-in, recording or any user journey.')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open SpeakSharp' })).toHaveAttribute('href', 'https://speaksharp-public.vercel.app/');
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('ops-health.summary.json'), { cache: 'no-store' });
  });

  it('reloads the published report and shows the newer check without dispatching a job', async () => {
    const updatedAt = new Date(Date.parse(now) + 30_000).toISOString();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonResponse(payload) as Response)
      .mockResolvedValueOnce(jsonResponse({
        ...payload, generatedAt: updatedAt,
        checks: [{ ...app, status: 'fail', evidence: 'Production app HTTP 503', checkedAt: updatedAt }, ...payload.checks.slice(1)],
      }) as Response);
    view();
    await screen.findByText('The production page responded');
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText('See what did not pass');
    const row = service('SpeakSharp');
    expect(row.querySelector('summary')).toHaveTextContent('Check failed');
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(updatedAt);
    fireEvent.click(row.querySelector('summary')!);
    expect(within(row).getByText('HTTP 503')).toBeInTheDocument();
    expect(row.querySelector('time')).toHaveAttribute('datetime', updatedAt);
    expect(vi.mocked(globalThis.fetch).mock.calls).toEqual([
      [summaryEndpoint, { cache: 'no-store' }], [summaryEndpoint, { cache: 'no-store' }],
    ]);
  });

  it('shows GitHub working even when SpeakSharp CI blocks release, with run and workflow links under GitHub', async () => {
    view();
    await screen.findByText('Repository and Actions readable');
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Action required');
    const row = service('GitHub');
    expect(row.querySelector('summary')).toHaveTextContent('Working');
    expect(row.open).toBe(false);
    fireEvent.click(row.querySelector('summary')!);
    expect(within(row).getByText('Repository API: Passed.')).toBeInTheDocument();
    expect(within(row).getByText('Actions API: Passed.')).toBeInTheDocument();
    expect(within(row).getByText('Latest CI run: Failed')).toBeInTheDocument();
    expect(within(row).getByText('Full live release gate on main: No qualifying run found')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open CI in Actions' })).toHaveAttribute('href', actions + '/runs/381');
    expect(within(row).getByRole('link', { name: 'Open release gate in Actions' })).toHaveAttribute('href', actions + '/workflows/rc-gates.yml');
    expect(within(row).getAllByText(/Recorded .* UTC/i)).toHaveLength(2);
    expect(screen.queryByText(/private=false/)).not.toBeInTheDocument();
  });

  it('does not show a green generation or end-to-end status from legacy Gemini catalog success', async () => {
    view();
    await screen.findByText('Gemini · Version: Not reported');
    expect(service('AI Service -- LLM').querySelector('summary')).toHaveTextContent('Review');
    expect(service('AI Service -- LLM').querySelector('summary')).not.toHaveTextContent('Working');
    expect(screen.queryByText('* Latest working version')).not.toBeInTheDocument();
  });

  it('groups Gemini checks and shows the highest verified version without claiming the configured model passed', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [
      ...payload.checks,
      { name: 'Gemini generation', status: 'fail', evidence: 'generation=rate_limited_429' },
      { name: 'Gemini highest working model', status: 'pass', evidence: 'provider_model_version=gemini-3.5-flash-lite-001; tested=gemini-3.6-flash:429:rate_limited_429,gemini-3.5-flash-lite:200:generated; untested_count=2;' },
    ] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    const row = service('AI Service -- LLM');
    expect(row.querySelector('summary')).toHaveTextContent('Check failed');
    expect(row.querySelector('summary')).toHaveTextContent('Gemini · Version: gemini-3.5-flash-lite-001*');
    expect(within(row).getByText('* Latest working version')).toBeInTheDocument();
    expect(row.open).toBe(false);
    const summaries = Array.from(screen.getByTestId('ops-status-checks').querySelectorAll('summary')).map(item => item.textContent);
    expect(summaries.filter(text => text?.includes('AI Service -- LLM'))).toHaveLength(1);
    expect(summaries.join(' ')).not.toMatch(/Gemini API|Gemini generation/);
    fireEvent.click(row.querySelector('summary')!);
    expect(row.open).toBe(true);
    expect(within(row).getByText('Gemini API: Passed.')).toBeInTheDocument();
    expect(within(row).getByText('Gemini generation: Did not pass.')).toBeInTheDocument();
    expect(within(row).getByText(/Highest tested model.*gemini-3.5-flash-lite-001/)).toBeInTheDocument();
    expect(within(row).getByText('gemini-3.6-flash: Rate limited (HTTP 429)')).toBeInTheDocument();
    expect(within(row).getByText('2 listed model(s) were not tested.')).toBeInTheDocument();
  });

  it('shows a safe typed observed version without relying on free-form evidence and never marks stale data current', async () => {
    const ai = { name: 'Gemini highest working model', status: 'pass', providerModelVersion: 'gemini-3.5-flash-lite-002', checkedAt: now };
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ...payload, checks: [...payload.checks, ai] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    let row = service('AI Service -- LLM');
    expect(row.querySelector('summary')).toHaveTextContent('Gemini · Version: gemini-3.5-flash-lite-002*');
    expect(within(row).getByText('* Latest working version')).toBeInTheDocument();
    expect(screen.queryByText('Gemini highest working model')).not.toBeInTheDocument();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ...payload,
      generatedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(), checks: [...payload.checks, ai],
    }) as Response);
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText(/Stale or bundled report/);
    row = service('AI Service -- LLM');
    expect(row.querySelector('summary')).toHaveTextContent('Historical');
    expect(within(row).queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(row.querySelector('sup')).toBeNull();
  });

  it('does not display unsafe or unreported model versions', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [...payload.checks, {
      name: 'Gemini highest working model', status: 'pass', providerModelVersion: 'gemini-secret=value',
      evidence: 'provider_model_version=unreported; highest_working=gemini-3.5-flash',
    }] }) as Response);
    view();
    await screen.findByText('Gemini · Version: Not reported');
    expect(screen.queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(service('AI Service -- LLM')).not.toHaveTextContent('secret=value');
    expect(service('AI Service -- LLM').querySelector('summary')).not.toHaveTextContent('gemini-3.5-flash');
  });

  it('accepts the old published schema without turning workflow failures into GitHub outages', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [app, { ...git, github: undefined }] }) as Response);
    view();
    await screen.findByText('Older report did not separate access from workflow results');
    expect(service('GitHub').querySelector('summary')).toHaveTextContent('Not checked');
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Action required');
  });

  it('shows a published report older than the daily freshness window as history', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({
      ...payload, generatedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    }) as Response);
    view();
    await screen.findByText(/Stale or bundled report\./);
    expect(service('GitHub').querySelector('summary')).toHaveTextContent('Historical');
    expect(screen.getByTestId('ops-status-verdict')).not.toHaveTextContent('Checks passed');
  });

  it('labels bundled fallback as historical and does not show a green current status', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(htmlResponse() as Response);
    view();
    await screen.findByText(/Stale or bundled report\./);
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Historical only');
    expect(service('SpeakSharp').querySelector('summary')).toHaveTextContent('Historical');
    expect(service('SpeakSharp').querySelector('summary')).not.toHaveTextContent('Working');
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, '/ops-health/ops-health.summary.json', { cache: 'no-store' });
  });
});
