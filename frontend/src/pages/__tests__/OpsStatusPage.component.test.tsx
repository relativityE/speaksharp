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
const view = () => render(<OpsStatusPage summaryEndpoint={summaryEndpoint} liveModelEndpoint={null} />, { route: '/admin/ops-status', path: '/admin/ops-status' });
function service(name: string): HTMLTableRowElement {
  const row = screen.getByText(name, { exact: true }).closest('tr');
  if (!row) throw Error('Service row not rendered: ' + name);
  return row;
}
const toggle = (row: HTMLTableRowElement) => within(row).getByRole('button');
const panel = (row: HTMLTableRowElement) => document.getElementById(toggle(row).getAttribute('aria-controls')!)!;
const status = (row: HTMLTableRowElement) => row.cells[1];
const info = (row: HTMLTableRowElement) => row.cells[0];

describe('OpsStatusPage', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload) as Response);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses one compact collapsed row per service, with scope and a real link in its drill-down', async () => {
    view();
    await screen.findByText('SpeakSharp', { exact: true });
    expect(screen.getByRole('heading', { name: 'Software health' })).toBeInTheDocument();
    expect(screen.getByText(/Latest published report/)).not.toBeVisible();
    expect(screen.getByRole('table', { name: 'Software API status' }).querySelectorAll('tbody th[scope=row]')).toHaveLength(3);
    const table = screen.getByRole('table', { name: 'Software API status' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Service', 'Status']);
    const row = service('SpeakSharp');
    expect(row.cells).toHaveLength(2);
    expect(panel(row).querySelector('td')).toHaveAttribute('colspan', '2');
    expect(within(status(row)).getByText('🟢')).toHaveAttribute('aria-hidden', 'true');
    expect(within(status(service('AI Service -- LLM'))).getByText('🟡')).toHaveAttribute('aria-hidden', 'true');
    expect(toggle(row)).toHaveAttribute('aria-expanded', 'false');
    expect(panel(row)).not.toBeVisible();
    expect(status(row)).toHaveTextContent('Working');
    expect(status(row)).not.toHaveTextContent(/stale|failed|unavailable/i);
    fireEvent.click(toggle(row));
    expect(toggle(row)).toHaveAttribute('aria-expanded', 'true');
    expect(panel(row)).toBeVisible();
    expect(within(panel(row)).getByText('Does not run sign-in, recording or any user journey.')).toBeInTheDocument();
    expect(within(panel(row)).getByRole('link', { name: 'Open SpeakSharp' })).toHaveAttribute('href', 'https://speaksharp-public.vercel.app/');
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('ops-health.summary.json'), { cache: 'no-store', signal: expect.any(AbortSignal) });
  });

  it('uses one shared legend and reveals checked capabilities only on expansion without raw key/value text', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [...payload.checks, {
      name: 'Sentry API', status: 'pass', evidence: 'project=200', checkedAt: now,
    }] }) as Response);
    view();
    await screen.findByText('Sentry', { exact: true });
    const row = service('Sentry');
    expect(status(row)).not.toHaveTextContent(/stale|failed|unavailable/i);
    expect(row).not.toHaveTextContent('project=200');
    expect(row).not.toHaveTextContent('Sentry APIs responsive');
    expect(within(row).queryByRole('tooltip')).toBeNull();
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('Sentry APIs responsive')).toBeVisible();
    expect(screen.getAllByLabelText('Status legend')).toHaveLength(1);
    const ai = service('AI Service -- LLM');
    expect(ai).not.toHaveTextContent('Generation not checked');
    fireEvent.click(toggle(ai));
    expect(within(panel(ai)).getByText('Generation not checked')).toBeVisible();
  });

  it.each([
    ['Stripe API', 'Stripe', 'fail', 'balance=200; pro=200:inactive; body=synthetic-private-value', 'Pro price: HTTP 200; price inactive'],
    ['Vercel API', 'Vercel', 'fail', 'scopeSupplied=false; http=401; provider=synthetic-private-value', 'Vercel API: HTTP 401'],
    ['Supabase API', 'Supabase', 'skip', 'missing=SYNTHETIC_PRIVATE_VALUE|SYNTHETIC_ALIAS', 'Required configuration is missing'],
    ['PostHog API', 'PostHog', 'fail', 'fetch failed', 'Could not connect to the service'],
  ])('shows a sanitized %s failure only in the expanded row', async (name, label, state, evidence, expected) => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload,
      checks: [{ name, status: state, evidence, checkedAt: now }],
    }) as Response);
    view();
    await screen.findByText(label);
    const row = service(label);
    expect(row).not.toHaveTextContent(expected);
    expect(status(row)).toHaveTextContent(state === 'skip' ? 'Review or not checked' : 'Check failed');
    expect(panel(row)).not.toBeVisible();
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText(expected, { exact: true })).toBeVisible();
    expect(panel(row)).not.toHaveTextContent(/synthetic.private.value|synthetic.alias|scopeSupplied|fetch failed/i);
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
    await screen.findByText('SpeakSharp', { exact: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText('New report loaded.');
    const row = service('SpeakSharp');
    expect(status(row)).toHaveTextContent('Check failed');
    expect(within(status(row)).getByText('🔴')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('HTTP 503')).toBeInTheDocument();
    expect(panel(row).querySelector('time')).toHaveAttribute('datetime', updatedAt);
    expect(vi.mocked(globalThis.fetch).mock.calls).toEqual([
      [summaryEndpoint, { cache: 'no-store', signal: expect.any(AbortSignal) }], [summaryEndpoint, { cache: 'no-store', signal: expect.any(AbortSignal) }],
    ]);
  });

  it('reports unchanged publication or a failed reload without running any health checks', async () => {
    view();
    await screen.findByText('GitHub');
    const reload = screen.getByRole('button', { name: 'Reload report' });
    fireEvent.click(reload);
    await screen.findByText('No new report published.');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('offline'));
    fireEvent.click(reload);
    await screen.findByText('Could not reload the report.');
    expect(reload).toBeEnabled();
    expect(status(service('GitHub'))).toHaveTextContent('Review or not checked');
  });

  it('shows a verified active Gemini 4 model without letting failed candidate diagnostics mark it down', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [
      ...payload.checks,
      { name: 'Gemini generation', status: 'pass', coachingReadiness: 'verified',
        configuredModelVersion: 'gemini-4-hydrogen', providerModelVersion: 'gemini-4-hydrogen' },
      { name: 'Gemini highest working model', status: 'fail' },
    ] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    const row = service('AI Service -- LLM');
    expect(row).not.toHaveTextContent('gemini-4-hydrogen');
    expect(status(row)).toHaveTextContent('Working');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('Configured model probe reported: gemini-4-hydrogen.')).toBeVisible();
  });

  it('does not mark production coaching working during backoff even if a diagnostic generated text', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [
      ...payload.checks,
      { name: 'Gemini generation', status: 'pass', coachingReadiness: 'backoff',
        configuredModelVersion: 'gemini-4-hydrogen', providerModelVersion: 'gemini-4-hydrogen' },
    ] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    const row = service('AI Service -- LLM');
    expect(status(row)).toHaveTextContent('Review or not checked');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('The historical report recorded a coaching provider wait.')).toBeVisible();
  });

  it('uses the winning ID and not a mismatched old typed model version', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [
      ...payload.checks,
      { name: 'Gemini highest working model', status: 'pass', providerModelVersion: 'gemini-3.5-flash-lite-001',
        evidence: 'highest_working=gemini-3.6-flash; provider_model_version=unreported;' },
    ] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    const row = service('AI Service -- LLM');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText(/Highest working candidate.*gemini-3.6-flash.*unreported/)).toBeVisible();
    expect(panel(row)).not.toHaveTextContent('gemini-3.5-flash-lite-001');
  });

  it('shows GitHub working even when SpeakSharp CI blocks release, with run and workflow links under GitHub', async () => {
    view();
    await screen.findByText('GitHub', { exact: true });
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Action required');
    const row = service('GitHub');
    expect(status(row)).toHaveTextContent('Working');
    expect(status(row)).not.toHaveTextContent(/stale|failed|unavailable/i);
    expect(toggle(row)).toHaveAttribute('aria-expanded', 'false');
    expect(panel(row)).not.toBeVisible();
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('Repository API: Passed.')).toBeInTheDocument();
    expect(within(panel(row)).getByText('Actions API: Passed.')).toBeInTheDocument();
    expect(within(panel(row)).getByText('Latest CI run: Failed')).toBeInTheDocument();
    expect(within(panel(row)).getByText('Full live release gate on main: No qualifying run found')).toBeInTheDocument();
    expect(within(panel(row)).getByRole('link', { name: 'Open CI in Actions' })).toHaveAttribute('href', actions + '/runs/381');
    expect(within(panel(row)).getByRole('link', { name: 'Open release gate in Actions' })).toHaveAttribute('href', actions + '/workflows/rc-gates.yml');
    expect(within(panel(row)).getAllByText(/Recorded .* UTC/i)).toHaveLength(2);
    expect(screen.queryByText(/private=false/)).not.toBeInTheDocument();
  });

  it('does not show a green generation or end-to-end status from legacy Gemini catalog success', async () => {
    view();
    await screen.findByText('AI Service -- LLM');
    expect(status(service('AI Service -- LLM'))).toHaveTextContent('Review');
    expect(status(service('AI Service -- LLM'))).not.toHaveTextContent('Working');
    expect(screen.queryByText('* Latest working version')).not.toBeInTheDocument();
  });

  it('keeps the configured model visible on failure and reports a working candidate separately', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [
      ...payload.checks,
      { name: 'Gemini generation', status: 'fail', configuredModelVersion: 'gemini-3.6-flash', evidence: 'generation=rate_limited_429' },
      { name: 'Gemini highest working model', status: 'pass', evidence: 'highest_working=gemini-3.5-flash-lite; provider_model_version=gemini-3.5-flash-lite-001; tested=gemini-3.6-flash:429:rate_limited_429,gemini-3.5-flash-lite:200:generated; untested_count=2;' },
    ] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    const row = service('AI Service -- LLM');
    expect(status(row)).toHaveTextContent('Check failed');
    expect(panel(row)).toHaveTextContent('Gemini · Configured model: gemini-3.6-flash');
    expect(within(row).queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(toggle(row)).toHaveAttribute('aria-expanded', 'false');
    expect(panel(row)).not.toBeVisible();
    const summaries = Array.from(screen.getByRole('table').querySelectorAll('tbody th[scope=row]')).map(item => item.textContent);
    expect(summaries.filter(text => text?.includes('AI Service -- LLM'))).toHaveLength(1);
    expect(summaries.join(' ')).not.toMatch(/Gemini API|Gemini generation/);
    fireEvent.click(toggle(row));
    expect(toggle(row)).toHaveAttribute('aria-expanded', 'true');
    expect(panel(row)).toBeVisible();
    expect(within(panel(row)).getByText('Gemini API: Passed.')).toBeInTheDocument();
    expect(within(panel(row)).getByText('Gemini generation: Did not pass.')).toBeInTheDocument();
    expect(within(panel(row)).getByText(/Highest working candidate.*gemini-3.5-flash-lite-001/)).toBeInTheDocument();
    expect(within(panel(row)).getByText('gemini-3.6-flash: Rate limited (HTTP 429)')).toBeInTheDocument();
    expect(within(panel(row)).getByText('2 listed model(s) were not tested.')).toBeInTheDocument();
  });

  it('does not infer a configured model from a legacy sweep and marks stale data historical', async () => {
    const ai = { name: 'Gemini highest working model', status: 'pass', providerModelVersion: 'gemini-3.5-flash-lite-002', checkedAt: now };
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ...payload, checks: [...payload.checks, ai] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    let row = service('AI Service -- LLM');
    expect(panel(row)).toHaveTextContent('Gemini · Configured model: Not in this report');
    expect(within(row).queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(screen.queryByText('Gemini highest working model')).not.toBeInTheDocument();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ ...payload,
      generatedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(), checks: [...payload.checks, ai],
    }) as Response);
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText('No current report available.');
    row = service('AI Service -- LLM');
    expect(status(row)).toHaveTextContent('Review or not checked');
    expect(within(row).queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(row.querySelector('sup')).toBeNull();
  });

  it('updates the configured model from new reports, not from the observed version', async () => {
    const report = (configuredModelVersion: string) => jsonResponse({ ...payload, checks: [...payload.checks, {
      name: 'Gemini generation', status: 'pass', configuredModelVersion, providerModelVersion: 'gemini-3.5-flash-lite-001',
    }] }) as Response;
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(report('gemini-3.6-flash'));
    view();
    await screen.findByText('AI Service -- LLM');
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(report('gemini-3.5-flash-lite'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    await screen.findByText('No new report published.');
    expect(panel(service('AI Service -- LLM'))).toHaveTextContent('Gemini · Configured model: gemini-3.5-flash-lite');
    const row = service('AI Service -- LLM');
    expect(info(row)).not.toHaveTextContent('gemini-3.5-flash-lite-001');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('Configured model probe reported: gemini-3.5-flash-lite-001.')).toBeInTheDocument();
  });

  it('does not display unsafe or unreported model versions', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [...payload.checks, {
      name: 'Gemini highest working model', status: 'pass', providerModelVersion: 'gemini-secret=value',
      evidence: 'provider_model_version=unreported; highest_working=gemini-3.5-flash',
    }] }) as Response);
    view();
    await screen.findByText('AI Service -- LLM');
    expect(screen.queryByText('* Latest working version')).not.toBeInTheDocument();
    expect(service('AI Service -- LLM')).not.toHaveTextContent('secret=value');
    expect(info(service('AI Service -- LLM'))).not.toHaveTextContent('gemini-3.5-flash');
  });

  it('accepts the old published schema without turning workflow failures into GitHub outages', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ...payload, checks: [app, { ...git, github: undefined }] }) as Response);
    view();
    await screen.findByText('GitHub');
    const row = service('GitHub');
    expect(row).not.toHaveTextContent('Older report did not separate access from workflow results');
    fireEvent.click(toggle(row));
    expect(within(panel(row)).getByText('Older report did not separate access from workflow results.')).toBeVisible();
    expect(status(service('GitHub'))).toHaveTextContent('Review or not checked');
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Action required');
  });

  it('shows a published report older than the daily freshness window as history', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({
      ...payload, generatedAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    }) as Response);
    view();
    await screen.findByText('GitHub');
    fireEvent.click(toggle(service('GitHub')));
    expect(screen.getByText(/Stale or bundled report\./)).toBeVisible();
    expect(status(service('GitHub'))).toHaveTextContent('Review or not checked');
    expect(screen.getByTestId('ops-status-verdict')).not.toHaveTextContent('Checks passed');
  });

  it('labels bundled fallback as historical and does not show a green current status', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(htmlResponse() as Response);
    view();
    await screen.findByText('GitHub');
    fireEvent.click(toggle(service('GitHub')));
    expect(screen.getByText(/Stale or bundled report\./)).toBeVisible();
    expect(screen.getByTestId('ops-status-verdict')).toHaveTextContent('Historical only');
    expect(status(service('SpeakSharp'))).toHaveTextContent('Review or not checked');
    expect(status(service('SpeakSharp'))).not.toHaveTextContent('Working');
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, '/ops-health/ops-health.summary.json', { cache: 'no-store', signal: expect.any(AbortSignal) });
  });
});

it('reads live selection without testing and checks only on Reload', async () => {
  const endpoint = '/admin/ops-status/coaching-model';
  const state = { model: 'gemini-3.5-flash-lite', serving: 'configured', source: 'selection',
    bootstrapModel: 'gemini-3.6-flash', readiness: 'verified', lastCheckOutcome: 'promoted',
    lastCheckAt: now, providerVersion: 'gemini-3.5-flash-lite' };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => jsonResponse(url === endpoint
    ? { state, outcome: options?.method === 'POST' ? 'promoted' : 'not_requested' } : payload) as Response);
  try {
    render(<OpsStatusPage summaryEndpoint={summaryEndpoint} liveModelEndpoint={endpoint} />, { route: '/admin/ops-status', path: '/admin/ops-status' });
    const selected = await screen.findByText('Gemini · Selected model: gemini-3.5-flash-lite');
    expect(selected).not.toBeVisible();
    expect(fetchMock.mock.calls.filter(([url]) => url === endpoint).map(([, init]) => init?.method)).toEqual(['GET']);
    fireEvent.click(toggle(service('AI Service -- LLM')));
    expect(selected).toBeVisible();
    expect(screen.getByText('Bootstrap config differs: gemini-3.6-flash (not used for serving).')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reload report' }));
    expect(await screen.findByText('Switched to gemini-3.5-flash-lite.')).toBeVisible();
    expect(fetchMock.mock.calls.filter(([url]) => url === endpoint).map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
  } finally { fetchMock.mockRestore(); }
});
