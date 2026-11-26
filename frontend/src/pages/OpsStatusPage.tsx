import React from 'react';
import { ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Status = 'pass' | 'warn' | 'fail' | 'skip';
type Workflow = {
  kind: 'ci' | 'canary' | 'release';
  outcome: 'passed' | 'failed' | 'pending' | 'missing' | 'unavailable';
  url?: string | null;
  runAt?: string | null;
  branch?: 'main' | 'other' | null;
};
type GitHub = {
  repository: Status;
  actions: Status;
  repositoryUrl?: string | null;
  actionsUrl?: string | null;
  workflows: Workflow[];
};
type Check = {
  name: string;
  status: Status;
  evidence?: string;
  checkedAt?: string;
  drilldownUrl?: string | null;
  github?: GitHub;
  providerModelVersion?: string;
  highestWorkingModel?: string;
  configuredModelVersion?: string;
  coachingReadiness?: string;
};
type Report = {
  generatedAt?: string;
  runContext?: string;
  summary?: Record<Status, number>;
  checks: Check[];
};
type Service = {
  name: string;
  status: Status;
  headline: string;
  versionVerified?: boolean;
  reason?: string;
  details: string[];
  checkedAt?: string;
  links?: { label: string; url?: string | null }[];
};

const STATUS_ICONS = { pass: '🟢', warn: '🟡', fail: '🔴' } as const;
const LABELS: Record<Status, string> = { pass: 'Working', fail: 'Check failed', warn: 'Review or not checked', skip: 'Review or not checked' };
const ORDER: Record<Status, number> = { fail: 0, warn: 1, skip: 2, pass: 3 };
const WORKFLOWS = { ci: 'Latest CI run', canary: 'Latest canary run', release: 'Full live release gate on main' } as const;
const OUTCOMES = { passed: 'Passed', failed: 'Failed', pending: 'In progress', missing: 'No qualifying run found', unavailable: 'Could not read' } as const;
const KNOWN: Record<string, { name: string; checked: string; limits: string; link: string }> = {
  App: { name: 'SpeakSharp', checked: 'The production page responded', limits: 'Does not run sign-in, recording or any user journey.', link: 'Open SpeakSharp' },
  'Vercel API': { name: 'Vercel', checked: 'Latest production deployment ready', limits: 'Does not verify app features or every deployment.', link: 'Open Vercel deployments' },
  'Supabase API': { name: 'Supabase', checked: 'Auth settings and usage endpoint reachable', limits: 'Reads Auth settings and checks whether the usage endpoint accepts a preflight. Does not sign a user in, run the function or query the database.', link: 'Open Supabase' },
  'Stripe API': { name: 'Stripe', checked: 'Balance and active Pro price readable', limits: 'Read-only. Does not create a charge, exercise checkout or verify webhook delivery.', link: 'Open Stripe' },
  'Sentry API': { name: 'Sentry', checked: 'Sentry APIs responsive', limits: 'Does not send a test error or verify ingestion.', link: 'Open Sentry' },
  'PostHog API': { name: 'PostHog', checked: 'Analytics test query responded', limits: 'Does not send a test event or verify ingestion.', link: 'Open PostHog' },
};
const MAX_CURRENT_AGE = 26 * 60 * 60 * 1000; // Daily report plus two hours for normal scheduling delay.
function publishedEndpoint() {
  const origin = import.meta.env.VITE_SUPABASE_URL;
  return origin ? String(origin).replace(/\/$/, '') + '/storage/v1/object/public/ops-health/ops-health.summary.json' : null;
}

const isStatus = (value: unknown): value is Status =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LABELS, value);

function timestamp(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    .format(new Date(value)) + ' UTC';
}

function safeLink(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hosts = ['speaksharp-public.vercel.app', 'vercel.com', 'supabase.com', 'dashboard.stripe.com',
      'sentry.io', 'us.posthog.com', 'aistudio.google.com', 'github.com'];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname)
      ? url.origin + url.pathname : null;
  } catch { return null; }
}

function outcomeText(status: Status) {
  return status === 'pass' ? 'Passed' : status === 'fail' ? 'Did not pass' : status === 'warn' ? 'Needs review' : 'Not checked';
}

const evidenceText = (check?: Check) => typeof check?.evidence === 'string' ? check.evidence.slice(0, 5000) : '';
const SAFE_GEMINI_VERSION = /^gemini-(?:4-(?:hydrogen|neon|argon|carbon)|\d{1,3}(?:\.\d{1,3})?-(?:pro|flash|flash-lite)(?:-\d{3})?)$/;
function observedGeminiVersion(check?: Check) {
  if (check?.status !== 'pass') return undefined;
  if (typeof check.providerModelVersion === 'string' && SAFE_GEMINI_VERSION.test(check.providerModelVersion)) {
    return check.providerModelVersion;
  }
  // Old reports used a bounded collector's provider-version field in the textual detail.
  const legacy = evidenceText(check).match(/\bprovider_model_version=([^;]+)(?:;|$)/)?.[1];
  return legacy && SAFE_GEMINI_VERSION.test(legacy) ? legacy : undefined;
}
const currentAge = (value?: string | null) => {
  const age = Date.now() - Date.parse(value ?? '');
  return Number.isFinite(age) && age >= 0 && age <= MAX_CURRENT_AGE;
};

const HTTP_FIELDS: Record<string, Record<string, string>> = {
  'Vercel API': { http: 'Vercel API' },
  'Supabase API': { auth: 'Auth settings', 'check-usage-limit': 'Usage preflight' },
  'Stripe API': { balance: 'Balance', pro: 'Pro price' },
  'Sentry API': { project: 'Sentry project' },
  'PostHog API': { query: 'Analytics query' },
};

function safeCheckDiagnostics(check: Check): { details: string[]; reason?: string } {
  const evidence = evidenceText(check);
  const details = new Set<string>();
  let reason: string | undefined;
  if (check.status === 'skip' && /^missing=[A-Z][A-Z0-9_]*(?:\|[A-Z][A-Z0-9_]*)*$/.test(evidence)) {
    reason = 'Required configuration is missing';
  } else if (check.status === 'fail' && /^(?:fetch failed|network_error)$/i.test(evidence)) {
    reason = 'Could not connect to the service';
  } else if (check.status === 'fail' && /^(?:This operation was aborted|The operation was aborted\.?|timeout)$/i.test(evidence)) {
    reason = 'The service request timed out';
  }
  if (reason) details.add(reason);
  for (const field of evidence.split(';', 16)) {
    const part = field.trim();
    const app = check.name === 'App' ? /^Production app HTTP ([1-5]\d{2})$/.exec(part) : null;
    const token = /^([a-z-]+)=([1-5]\d{2})(:inactive)?$/.exec(part);
    const fields = HTTP_FIELDS[check.name];
    const label = token && fields && Object.prototype.hasOwnProperty.call(fields, token[1]) ? fields[token[1]] : null;
    if (app) {
      const message = 'HTTP ' + app[1];
      details.add(message);
      if (Number(app[1]) >= 400) reason ??= message;
    } else if (label && token && (!token[3] || check.name === 'Stripe API' && token[1] === 'pro')) {
      const message = label + ': HTTP ' + token[2] + (token[3] ? '; price inactive' : '');
      details.add(message);
      if (token[3] || Number(token[2]) >= 400) reason ??= message;
    }
  }
  return { details: [...details], reason };
}

function checksForDisplay(checks: Check[]): Service[] {
  const cards: Service[] = [];
  for (const check of checks) {
    const scope = Object.prototype.hasOwnProperty.call(KNOWN, check.name) ? KNOWN[check.name] : null;
    if (!scope) continue;
    const { details: diagnostics, reason } = safeCheckDiagnostics(check);
    const deployment = check.name === 'Vercel API' ? evidenceText(check).match(/\blatest=(READY|BUILDING|QUEUED|INITIALIZING|ERROR|CANCELED)\b/)?.[1] : null;
    const details = [...diagnostics, ...(deployment ? ['Deployment state: ' + deployment.toLowerCase() + '.'] : []), scope.limits];
    cards.push({ name: scope.name, status: check.status,
      headline: scope.checked,
      reason: reason ?? (check.status === 'fail' ? 'Service check failed'
        : check.status === 'warn' ? (deployment ? 'Deployment ' + deployment.toLowerCase() : 'Check needs review') : 'Check unavailable'),
      details, checkedAt: check.checkedAt, links: [{ label: scope.link, url: check.drilldownUrl }] });
  }

  const gemini = checks.find((check) => check.name === 'Gemini API');
  const generation = checks.find((check) => check.name === 'Gemini generation');
  const sweep = checks.find((check) => check.name === 'Gemini highest working model');
  if (gemini || generation || sweep) {
    const untested = evidenceText(sweep).match(/\buntested_count=(\d{1,3})(?:;|$)/)?.[1];
    const legacyWinner = evidenceText(sweep).match(/\bhighest_working=([^;]+)(?:;|$)/)?.[1];
    const sweepWinner = sweep?.status === 'pass'
      ? [sweep.highestWorkingModel, legacyWinner].find((id) => id && SAFE_GEMINI_VERSION.test(id)) : undefined;
    // Older typed reports could pick a lower-ranked result's observed version.
    const legacyVersion = evidenceText(sweep).match(/\bprovider_model_version=([^;]+)(?:;|$)/)?.[1];
    const sweepVersion = sweepWinner && sweep?.highestWorkingModel === sweepWinner
      ? observedGeminiVersion(sweep) : legacyVersion && SAFE_GEMINI_VERSION.test(legacyVersion) ? legacyVersion : undefined;
    const generationVersion = observedGeminiVersion(generation);
    const configuredModel = typeof generation?.configuredModelVersion === 'string'
      && /^gemini-[a-z0-9][a-z0-9.-]{0,58}$/.test(generation.configuredModelVersion)
      ? generation.configuredModelVersion : undefined;
    const models = evidenceText(sweep).match(/\btested=([^;]+)/)?.[1]?.split(',').slice(0, 8) ?? [];
    const modelResults = models
      .map((entry) => entry.match(/^([^:]+):([1-5]\d{2}|no_http):(generated|empty|malformed|rate_limited_429|unavailable_503|http_error|timeout|network_error)$/))
      .filter((match): match is RegExpMatchArray => !!match && SAFE_GEMINI_VERSION.test(match[1]))
      .map(([, modelId, code, reason]) => {
        const wording: Record<string, string> = { generated: 'Generated text', empty: 'No text', malformed: 'Unreadable response',
          rate_limited_429: 'Rate limited', unavailable_503: 'Unavailable', http_error: 'Request failed',
          timeout: 'Timed out', network_error: 'Connection failed' };
        return modelId + ': ' + wording[reason] + (code === 'no_http' ? '' : ' (HTTP ' + code + ')');
      });
    const readiness = generation?.coachingReadiness;
    const status = generation?.status === 'fail' || gemini?.status === 'fail' || readiness === 'unavailable' ? 'fail'
      : readiness === 'checking' || readiness === 'not_checked' ? 'warn'
        : generation?.status === 'pass' && gemini?.status === 'pass' ? 'pass'
        : generation?.status === 'pass' || sweepWinner || gemini?.status === 'pass' ? 'warn' : 'skip';
    cards.push({ name: 'AI Service -- LLM', status,
      reason: readiness === 'unavailable' ? 'Valid coaching not verified'
        : readiness === 'checking' ? 'Coaching readiness check pending'
          : readiness === 'not_checked' && generation?.status === 'pass' ? 'Coaching readiness not checked'
            : generation?.status === 'fail' ? 'Configured model generation failed'
        : gemini?.status === 'fail' ? 'Model list check failed'
          : sweep?.status === 'fail' ? 'No tested model generated text'
            : !generation || generation.status === 'skip' ? 'Generation not checked' : 'Model version not verified',
      headline: 'Gemini · Configured model: ' + (configuredModel ?? 'Not in this report'),
      versionVerified: Boolean(sweepWinner && sweepVersion),
      checkedAt: generation?.checkedAt ?? gemini?.checkedAt ?? sweep?.checkedAt,
      details: ['Gemini API: ' + outcomeText(gemini?.status ?? 'skip') + '.',
        'Gemini generation: ' + outcomeText(generation?.status ?? 'skip') + '.',
        'The API check reads the model list. The generation check sends test text to the configured model.',
        ...(readiness === 'verified' ? ['Deployed coaching passed the recording-start readiness check.']
          : readiness === 'checking' || readiness === 'not_checked' || readiness === 'unavailable'
            ? ['Deployed coaching readiness is not verified in this report.'] : []),
        generationVersion ? 'Configured model probe reported: ' + generationVersion + '.'
          : 'Configured model probe did not report a version.',
        ...(sweepWinner ? ['Highest working candidate in this probe: ' + sweepWinner + ' (observed version: ' + (sweepVersion ?? 'unreported') + (sweepVersion ? '*).' : ').')] : []),
        ...modelResults,
        ...(untested && Number(untested) > 0 ? [untested + ' listed model(s) were not tested.'] : []),
        'Synthetic text only. Does not verify coaching in SpeakSharp or change its configured model.'],
      links: [{ label: 'Open Google AI Studio', url: generation?.drilldownUrl ?? gemini?.drilldownUrl ?? sweep?.drilldownUrl }] });
  }

  const git = checks.find((check) => check.name === 'GitHub API');
  if (git) {
    const github = git.github;
    const repository = isStatus(github?.repository) ? github.repository : 'skip';
    const actions = isStatus(github?.actions) ? github.actions : 'skip';
    const status = repository === 'fail' || actions === 'fail' ? 'fail'
      : repository === 'pass' && actions === 'pass' ? 'pass'
        : repository === 'pass' || actions === 'warn' ? 'warn' : 'skip';
    cards.push({ name: 'GitHub', status, checkedAt: git.checkedAt,
      headline: 'Repository and Actions APIs readable',
      reason: !github ? undefined
        : repository === 'fail' ? 'Repository API did not respond as expected'
          : actions === 'fail' ? 'Actions run list unavailable' : 'Actions access not fully verified',
      details: [...(!github ? ['Older report did not separate access from workflow results.'] : []), 'Repository API: ' + outcomeText(repository) + '.', 'Actions API: ' + outcomeText(actions) + '.',
        'CI, canary and release outcomes are listed separately below.'],
      links: [{ label: 'Open repository', url: github?.repositoryUrl }, { label: 'Open Actions', url: github?.actionsUrl ?? git.drilldownUrl }] });
  }
  return cards.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}

export const OpsStatusPage: React.FC<{ summaryEndpoint?: string }> = ({ summaryEndpoint }) => {
  const [report, setReport] = React.useState<Report | null>(null);
  const [bundled, setBundled] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [reloadResult, setReloadResult] = React.useState('');
  const publishedAt = React.useRef<string | null>(null);

  const load = React.useCallback(async (manual = false) => {
    setLoading(true);
    setLoadFailed(false);
    if (manual) setReloadResult('Checking for a new report…');
    const published = summaryEndpoint ?? publishedEndpoint();
    for (const endpoint of [published, '/ops-health/ops-health.summary.json', '/ops-health.summary.json']) {
      if (!endpoint) continue;
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) continue;
        const next = JSON.parse(await response.text()) as Report;
        if (!Array.isArray(next?.checks)
          || !next.checks.every((check) => check && typeof check.name === 'string' && isStatus(check.status))) continue;
        setReport(next);
        const isBundled = endpoint !== published || next.runContext !== 'GitHub Actions';
        setBundled(isBundled);
        if (manual) setReloadResult(isBundled || !currentAge(next.generatedAt) ? 'No current report available.'
          : publishedAt.current === next.generatedAt ? 'No new report published.' : 'New report loaded.');
        if (!isBundled) publishedAt.current = next.generatedAt ?? null;
        setLoading(false);
        return;
      } catch { /* Try historical fallback. Never display endpoint errors or raw response. */ }
    }
    setLoadFailed(true);
    if (manual) setReloadResult('Could not reload the report.');
    setLoading(false);
  }, [summaryEndpoint]);
  React.useEffect(() => { void load(); }, [load]);

  const historical = Boolean(report) && (bundled || loadFailed || !currentAge(report?.generatedAt));
  const checks = report?.checks ?? [];
  const services = checksForDisplay(checks);
  const github = checks.find((check) => check.name === 'GitHub API')?.github;
  const workflows = Array.isArray(github?.workflows)
    ? github.workflows.filter((row) => row && Object.prototype.hasOwnProperty.call(WORKFLOWS, row.kind) && Object.prototype.hasOwnProperty.call(OUTCOMES, row.outcome))
    : [];
  const blocked = (report?.summary?.fail ?? 0) > 0 || checks.some((check) => check.status === 'fail')
    || workflows.some((workflow) => workflow.outcome === 'failed');
  const releaseLabel = historical ? 'Historical only'
    : blocked ? 'Action required'
      : !report || workflows.length !== 3 || workflows.some(({ outcome, runAt, branch }) => outcome !== 'passed' || !currentAge(runAt) || branch !== 'main')
        || checks.some(({ status }) => status !== 'pass') ? 'Not verified' : 'Checks passed';

  return (
    <div className="min-h-screen bg-background px-4 pb-4 pt-24 lg:pt-20">
      <div className="mx-auto max-w-4xl space-y-2 lg:max-w-[min(75vw,56rem)]">
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-foreground">Software health</h1>
          </div>
          <Button onClick={() => { void load(true); }} disabled={loading}>
            <RefreshCw aria-hidden="true" className={'mr-2 h-4 w-4 ' + (loading ? 'animate-spin' : '')} />
            Reload report
          </Button>
        </header>

        <p role="status" className="text-sm text-muted-foreground">{reloadResult ||
          (!report ? (loading ? 'Loading report…' : 'No report available.') : '')}</p>
        {services.length > 0 ? (
          <section data-testid="ops-status-checks">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-2 text-sm text-foreground" aria-label="Status legend">
              {([['pass', 'Working'], ['warn', 'Review or not checked'], ['fail', 'Check failed']] as const).map(([tone, label]) => (
                <span key={tone} className="inline-flex items-center gap-1.5"><StatusIcon tone={tone} />{label}</span>
              ))}
            </div>
            <table className="w-full table-fixed border-collapse text-base lg:text-lg" aria-label="Software API status">
              <thead className="border-y border-border text-sm text-foreground lg:text-base">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 text-left">Service</th>
                  <th scope="col" className="w-1/2 py-1.5 text-left lg:w-2/5">Status</th>
                </tr>
              </thead>
              <tbody>{services.map((service) => (
                <ServiceRow key={service.name} service={service} historical={historical || (!!service.checkedAt && !currentAge(service.checkedAt))}>
                  {service.name === 'GitHub' ? <>
                    <p className="text-muted-foreground">
                      {historical ? 'Stale or bundled report. Current status is not verified.' : 'Latest published report.'}
                      {timestamp(report?.generatedAt) ? <> Published <time dateTime={report?.generatedAt}>{timestamp(report?.generatedAt)}</time>.</> : ''}
                    </p>
                    <p>Release checks: <strong data-testid="ops-status-verdict">{releaseLabel}</strong></p>
                    <ReleaseDetails workflows={workflows} />
                  </> : null}
                </ServiceRow>
              ))}</tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
};

const DetailLink: React.FC<{ label: string; url?: string | null }> = ({ label, url }) => {
  const href = safeLink(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline">
      {label} <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  ) : null;
};

const ReleaseDetails: React.FC<{ workflows: Workflow[] }> = ({ workflows }) => (
  <section className="space-y-2 border-t border-border pt-2" aria-label="SpeakSharp workflows">
    <h2 className="font-semibold">SpeakSharp workflows</h2>
    <p className="text-muted-foreground">Workflow results are not GitHub outages or release approval.</p>
    {workflows.length > 0 ? (
      <ul className="divide-y divide-border">
        {workflows.map((workflow) => (
          <li key={workflow.kind} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <div>
              <span>{WORKFLOWS[workflow.kind]}: {OUTCOMES[workflow.outcome]}</span>
              {workflow.branch === 'other' ? <span> (other branch)</span> : workflow.branch === 'main' && workflow.kind !== 'release' ? <span> (main)</span> : null}
              {timestamp(workflow.runAt) ? (
                <span className="block text-muted-foreground">
                  {currentAge(workflow.runAt) ? 'Recorded ' : 'Older run · recorded '}{timestamp(workflow.runAt)}
                </span>
              ) : null}
            </div>
            <DetailLink label={'Open ' + (workflow.kind === 'ci' ? 'CI' : workflow.kind === 'canary' ? 'canary' : 'release gate') + ' in Actions'} url={workflow.url} />
          </li>
        ))}
      </ul>
    ) : <p>No separate workflow evidence in this report.</p>}
  </section>
);

const StatusIcon: React.FC<{ tone: keyof typeof STATUS_ICONS }> = ({ tone }) => (
  <span aria-hidden="true" className="inline-block shrink-0 text-lg leading-none"
    style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", emoji, sans-serif' }}>
    {STATUS_ICONS[tone]}
  </span>
);

const ServiceRow: React.FC<React.PropsWithChildren<{ service: Service; historical: boolean }>> = ({ service, historical, children }) => {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const tone = historical || service.status === 'skip' ? 'warn' : service.status;
  const reason = historical ? 'Stale report' : service.status === 'pass' ? '' : (service.reason ?? 'Check unavailable');
  return (
    <>
      <tr className="border-b border-border">
        <th scope="row" className="py-1.5 pr-3 text-left align-top font-semibold text-foreground">
          {service.name}
        </th>
        <td className="py-1.5 align-top">
          <div className="flex items-start justify-between gap-1 sm:gap-3">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <StatusIcon tone={tone} />{LABELS[tone]}
              </span>
            </div>
            <button type="button"
              className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-expanded={open} aria-controls={id + '-details'}
              aria-label={(open ? 'Hide ' : 'Show ') + service.name + ' details'} onClick={() => setOpen(!open)}>
              <ChevronDown aria-hidden="true" className={'h-4 w-4 ' + (open ? 'rotate-180' : '')} />
            </button>
          </div>
        </td>
      </tr>
      <tr id={id + '-details'} hidden={!open}>
        <td colSpan={2} className="space-y-2 break-words py-2 pl-3 text-sm">
          {service.headline ? <p>{service.headline}</p> : null}
          {reason && !service.details.includes(reason) ? <p>{reason}</p> : null}
          <ul className="list-disc space-y-1 pl-5">{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          {timestamp(service.checkedAt) ? <p className="text-muted-foreground">Last checked <time dateTime={service.checkedAt}>{timestamp(service.checkedAt)}</time></p> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {service.links?.map((link) => <DetailLink key={link.label} {...link} />)}
          </div>
          {children}
          {service.versionVerified && !historical ? <p className="text-xs text-muted-foreground">* Latest working version</p> : null}
        </td>
      </tr>
    </>
  );
};

export default OpsStatusPage;
