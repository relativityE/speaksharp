#!/usr/bin/env node
/**
 * Read-only Sentry diagnostic — query real issues by search (URL/message/time) and print the latest
 * event's exception stack, so a "generic Oops" boundary error becomes a named throw at a file:line.
 *
 * Runs in CI where SENTRY_AUTH_TOKEN/ORG/PROJECT/API_BASE are injected (see sentry-diagnose.yml),
 * mirroring the established observability-api-smoke pattern. The dev never holds the prod token.
 *
 * SAFETY (non-negotiable): the frontend Sentry init is `sendDefaultPii: false` + a console-breadcrumb
 * scrubber, specifically so Private-mode transcript text can never leave the device via Sentry. This
 * reader preserves that posture: it prints ONLY issue title/culprit/message and exception FRAMES
 * (filename/function/lineNo). It NEVER prints `extra`, `breadcrumbs`, `context`, `request`, or `tags`
 * that could carry user text.
 *
 * A 403 means the token lacks `issue:read`/`event:read` scope (or org access) — that is a finding to
 * report (widen the token scope in Sentry settings), not something to work around.
 */

// --- reused verbatim from scripts/live-observability-proof.mjs (auth + endpoint shape) ---
function getSentryApiBase() {
  const raw = process.env.SENTRY_API_BASE ?? 'https://sentry.io/api/0';
  const url = new URL(raw);
  const normalizedPath = url.pathname.replace(/\/$/, '');
  url.pathname = normalizedPath.endsWith('/api/0') ? normalizedPath : `${normalizedPath}/api/0`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
function parseSentryDsn(dsn) {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).at(-1);
  if (!projectId) throw new Error('SENTRY_DSN is missing a project id path segment');
  return { projectId };
}
function getSentrySearchRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}
function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/[a-f0-9]{24,}/gi, '<id>')}`;
  } catch {
    return String(value).replace(/[a-f0-9]{24,}/gi, '<id>');
  }
}
function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function getArg(name) {
  const prefix = `${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function sentryGet(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}`, Accept: 'application/json' },
  });
  const bodyText = await response.text();
  if (response.status === 403) {
    throw new Error(`Sentry HTTP 403 — token lacks issue:read/event:read scope or org access. WIDEN the SENTRY_AUTH_TOKEN scope in Sentry settings (not a code fix). ${bodyText.slice(0, 300)}`);
  }
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Error(`Sentry HTTP ${response.status} @ ${redactUrl(url)}: ${bodyText.slice(0, 300)}`);
  return { status: response.status, body: parseJson(bodyText) };
}

// print ONLY message + frames from the latest event's exception entry (no PII fields).
function printException(ev) {
  const entries = Array.isArray(ev?.entries) ? ev.entries : [];
  const exc = entries.find((e) => e.type === 'exception');
  const values = exc?.data?.values ?? [];
  if (values.length === 0) { console.log('  (no exception entry on latest event)'); return; }
  for (const v of values) {
    console.log(`  ${v.type ?? 'Error'}: ${v.value ?? ''}`);
    const frames = v.stacktrace?.frames ?? [];
    const inApp = frames.filter((f) => f.inApp);
    const show = (inApp.length ? inApp : frames).slice(-14); // throw site is the last frame
    for (const f of show) {
      console.log(`    at ${f.function ?? '?'} (${f.filename ?? f.absPath ?? '?'}:${f.lineNo ?? '?'}${f.colNo != null ? ':' + f.colNo : ''})${f.inApp ? '' : '  [vendor]'}`);
    }
  }
}

async function main() {
  requireEnv('SENTRY_AUTH_TOKEN');
  const apiBase = getSentryApiBase();
  const org = encodeURIComponent(requireEnv('SENTRY_ORG'));
  const project = process.env.SENTRY_DSN ? parseSentryDsn(process.env.SENTRY_DSN).projectId : '-1';
  const statsPeriod = getArg('--statsPeriod') ?? process.env.SENTRY_DIAG_STATS_PERIOD ?? '24h';
  const primaryQuery = getArg('--query') ?? process.env.SENTRY_DIAG_QUERY ?? 'is:unresolved url:*analytics*';
  const maxIssues = Number(getArg('--max') ?? 3);

  const listIssues = async (query) => {
    const params = new URLSearchParams({ project, statsPeriod, sort: 'date', query });
    const url = `${apiBase}/organizations/${org}/issues/?${params}`;
    console.log(`SENTRY_DIAG issues query="${query}" statsPeriod=${statsPeriod} api=${redactUrl(url)}`);
    const { body } = await sentryGet(url);
    return getSentrySearchRows(body);
  };

  let rows = await listIssues(primaryQuery);
  if (rows.length === 0 && primaryQuery !== 'is:unresolved') {
    console.log('SENTRY_DIAG primary query empty — widening to is:unresolved (most-recent first).');
    rows = await listIssues('is:unresolved');
  }
  console.log(`SENTRY_DIAG matched ${rows.length} issue(s)`);
  if (rows.length === 0) { console.log('SENTRY_DIAG no issues in window — try a longer --statsPeriod (e.g. 7d).'); return; }

  const top = rows.slice(0, Math.min(rows.length, maxIssues));
  for (let i = 0; i < top.length; i++) {
    const issue = top[i];
    const id = issue.id ?? issue.issueId;
    console.log(`\n=== ISSUE ${i + 1}/${top.length} (id=${id}) ===`);
    console.log(`title   : ${issue.title ?? issue.metadata?.type ?? '(none)'}`);
    console.log(`culprit : ${issue.culprit ?? '(none)'}`);
    console.log(`value   : ${issue.metadata?.value ?? '(none)'}`);
    console.log(`meta    : count=${issue.count ?? '?'} lastSeen=${issue.lastSeen ?? '?'} level=${issue.level ?? '?'}`);
    const { status, body: ev } = await sentryGet(`${apiBase}/organizations/${org}/issues/${encodeURIComponent(id)}/events/latest/`);
    if (status === 404 || !ev) { console.log('  (no latest event available)'); continue; }
    printException(ev);
  }
  console.log('\nSENTRY_DIAG done — printed title/culprit/message/frames ONLY (no extra/breadcrumbs/context/request; PII posture preserved).');
}

main().catch((err) => { console.error(`SENTRY_DIAG error: ${err.message}`); process.exit(1); });
