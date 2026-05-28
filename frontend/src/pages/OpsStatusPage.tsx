import React from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type OpsStatus = 'pass' | 'warn' | 'fail' | 'skip';

type OpsCheck = {
  name: string;
  status: OpsStatus;
  label: string;
  icon: string;
  question: string;
  evidence: string;
  nextAction: string;
  latencyMs?: number;
  checkedAt?: string;
  drilldownUrl?: string | null;
};

type OpsSummary = Record<OpsStatus, number>;

type OpsPayload = {
  generatedAt: string;
  baseUrl?: string;
  repo?: string;
  runContext?: string;
  durationMs?: number;
  summary: OpsSummary;
  verdict: string;
  checks: OpsCheck[];
};

const STATUS_STYLES: Record<OpsStatus, string> = {
  pass: 'border-success/30 bg-success/10 text-success',
  fail: 'border-destructive/35 bg-destructive/10 text-destructive',
  warn: 'border-primary/35 bg-primary/10 text-primary',
  skip: 'border-slate-400/40 bg-slate-100 text-slate-700',
};

const ORDER: Record<OpsStatus, number> = {
  fail: 0,
  warn: 1,
  skip: 2,
  pass: 3,
};

const SUPABASE_PUBLIC_SUMMARY_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/storage/v1/object/public/ops-health/ops-health.summary.json`
  : null;

const FALLBACK_ENDPOINTS = [
  SUPABASE_PUBLIC_SUMMARY_URL,
  '/ops-health/ops-health.summary.json',
  '/ops-health.summary.json',
].filter(Boolean) as string[];

export const OpsStatusPage: React.FC = () => {
  const [payload, setPayload] = React.useState<OpsPayload | null>(null);
  const [source, setSource] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadStatus = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    for (const endpoint of FALLBACK_ENDPOINTS) {
      try {
        const result = await fetch(endpoint, { cache: 'no-store' });
        if (!result.ok) {
          throw new Error(`${endpoint} returned ${result.status}`);
        }
        const body = await readOpsPayload(result, endpoint);
        setPayload(body);
        setSource(sourceLabel(endpoint));
        setLoading(false);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const checks = React.useMemo(
    () => [...(payload?.checks ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name)),
    [payload]
  );

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-28">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Admin Ops</p>
            <h1 className="mt-2 text-3xl font-extrabold text-foreground md:text-4xl">
              Software API Status
            </h1>
            <p className="mt-3 max-w-3xl text-base text-muted-foreground">
              A simple release-readiness view over the GitHub ops-health result. GitHub does the detailed checks; this page shows the quick go/no-go signal.
            </p>
          </div>
          <Button onClick={() => { void loadStatus(); }} disabled={loading} className="w-full md:w-auto">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </header>

        <Card className="p-5">
          <div className="grid gap-4 md:grid-cols-[1.2fr_2fr]">
            <div>
              <div className="text-sm font-semibold text-muted-foreground">Verdict</div>
              <div className="mt-1 text-2xl font-extrabold text-foreground" data-testid="ops-status-verdict">
                {payload?.verdict ?? (loading ? 'Loading...' : 'Status unavailable')}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Source: {source || 'none'} {payload?.runContext ? `· ${payload.runContext}` : ''}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryTile label="OK" icon="🟢" value={payload?.summary.pass ?? 0} />
              <SummaryTile label="Review" icon="🟡" value={payload?.summary.warn ?? 0} />
              <SummaryTile label="Down" icon="🔴" value={payload?.summary.fail ?? 0} />
              <SummaryTile label="Not Ready" icon="🚧" value={payload?.summary.skip ?? 0} />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>Generated: {payload?.generatedAt ? formatTimestamp(payload.generatedAt) : 'not available'}</span>
            <span>{payload?.durationMs ? `Check duration: ${payload.durationMs}ms` : error ? `Last error: ${error}` : null}</span>
          </div>
        </Card>

        <div className="grid gap-4" data-testid="ops-status-checks">
          {loading && !payload ? (
            <Card className="p-6 text-muted-foreground">Loading software API status...</Card>
          ) : checks.length ? (
            checks.map((check) => <OpsCheckCard key={check.name} check={check} />)
          ) : (
            <Card className="p-6 text-destructive">No ops-health checks were available.</Card>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryTile: React.FC<{ label: string; icon: string; value: number }> = ({ label, icon, value }) => (
  <div className="rounded-xl border border-border bg-white px-4 py-3 surface-shadow">
    <div className="text-sm font-semibold text-muted-foreground">{label}</div>
    <div className="mt-1 flex items-center gap-2 text-2xl font-extrabold text-foreground">
      <span aria-hidden="true">{icon}</span>
      <span>{value}</span>
    </div>
  </div>
);

const OpsCheckCard: React.FC<{ check: OpsCheck }> = ({ check }) => (
  <Card className="p-5">
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">{check.name}</h2>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${STATUS_STYLES[check.status]}`}>
            <span aria-hidden="true">{check.icon}</span>
            <span>{check.label}</span>
          </span>
        </div>
        <p className="mt-2 text-sm font-semibold text-muted-foreground">{check.question}</p>
        <p className="mt-3 break-words text-base text-foreground">{check.evidence}</p>
        <p className="mt-2 text-sm text-muted-foreground">{check.nextAction}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 text-sm text-muted-foreground md:items-end">
        {typeof check.latencyMs === 'number' ? <span>{check.latencyMs}ms</span> : null}
        {check.checkedAt ? <span>{formatTimestamp(check.checkedAt)}</span> : null}
        {check.drilldownUrl ? (
          <a
            href={check.drilldownUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Drill down
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  </Card>
);

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function readOpsPayload(response: Response, endpoint: string): Promise<OpsPayload> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(`${endpoint} returned HTML instead of ops JSON`);
  }

  try {
    return JSON.parse(text) as OpsPayload;
  } catch (error) {
    throw new Error(`${endpoint} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sourceLabel(endpoint: string) {
  if (endpoint.includes('/storage/v1/object/public/ops-health/')) return 'GitHub Ops Health JSON';
  if (endpoint.includes('/ops-health/')) return 'Bundled fallback JSON';
  return endpoint;
}

export default OpsStatusPage;
