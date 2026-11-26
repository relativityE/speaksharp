// Pure rendering / aggregation for the ops-health dashboard. Extracted from ops-health.mjs so the JSON and
// Markdown output surfaces (and the exit-code rule) are importable and unit-testable without executing the
// full dashboard. No I/O, no network, no process side effects.

export function summarize(items) {
  return items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 },
  );
}

// The single source of truth for the process exit code: any hard failure → non-zero.
export function exitCodeForRows(rows) {
  return rows.some((row) => row.status === 'fail') ? 1 : 0;
}

export function verdictLabel(check) {
  if (check.status === 'pass') return 'OK';
  if (check.status === 'fail') return 'DOWN';
  if (check.status === 'skip') return 'NOT READY';
  return 'REVIEW';
}

export function statusIcon(check) {
  if (check.status === 'pass') return '🟢';
  if (check.status === 'fail') return '🔴';
  if (check.status === 'skip') return '🚧';
  return '🟡';
}

export function statusBadge(check) {
  return `${statusIcon(check)} ${verdictLabel(check)}`;
}

export function nextAction(check, runContext) {
  if (check.status === 'pass') return 'No action.';
  if (/stale\/missing=/.test(check.detail)) return 'Run or refresh the named benchmark before making benchmark claims.';
  if (/missing=|skip\(/.test(check.detail)) {
    return runContext === 'GitHub Actions'
      ? 'Wire the expected GitHub secret name or update the check to the real secret name.'
      : 'Run the GitHub Ops Health workflow for the secret-backed result.';
  }
  if (check.name === 'GitHub') return 'Open Actions and fix the red release workflow before tester release.';
  if (check.status === 'fail') return 'Open the vendor dashboard or drill-down and resolve before release.';
  return 'Review before release.';
}

export function esc(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function runLink(run) {
  return '[#' + run.id + (run.attempt ? ' (attempt ' + run.attempt + ')' : '') + '](' + run.runUrl + ')';
}

function renderCanaryActivity(lines, activity) {
  lines.push('', '## Canary activity (' + activity.dateUtc + ' UTC)', '');
  if (activity.coverage === 'unavailable') lines.push('Run history unavailable.');
  if (activity.coverage === 'incomplete') lines.push('Run history incomplete; additional runs or attempts may exist.');
  if (activity.noRuns) lines.push('🔴 No run today.');
  const runText = (row) => {
    if (!row) return 'none recorded';
    const time = row.startedAt ? 'started ' + row.startedAt : 'run created ' + row.createdAt;
    return runLink(row) + ': ' + row.trigger + ', ' + row.status + ' (' + time + ')';
  };
  if (!activity.latest) return;
  lines.push('- Latest run: ' + runText(activity.latest), '- Latest pass: ' + runText(activity.latestGreen));
  const failureLine = (label, { attempt, evidence }) => {
    if (!evidence) return '- ' + label + ': ' + runLink(attempt) + '; failed-step time/details unavailable.';
    const when = evidence.endedAt
      ? evidence.endedAt + (evidence.timeBasis === 'job-completed' ? ' (job ended)' : '')
      : 'time not recorded';
    const where = evidence.step ? evidence.job + ': ' + evidence.step : evidence.job;
    const reason = evidence.reasonCode ? ' (' + evidence.reasonCode.replace(/_/g, ' ') + ')' : '';
    return '- ' + label + ': ' + when + ', [' + esc(where) + '](' + evidence.logUrl + ')' + reason + '.';
  };
  if (activity.firstFailure) lines.push(failureLine('First failure', activity.firstFailure));
  for (const row of activity.distinct) lines.push(failureLine(row.evidence.step ? 'Distinct later failed step' : 'Distinct later failure', row));
  if (activity.unclassifiedFailures) {
    lines.push('- ' + activity.unclassifiedFailures + ' failed attempt(s) also had later evidence without a recognized upstream job and step.');
  }
  lines.push('', 'Based on runs created on this UTC date and their same-day attempts. Retries of earlier runs are not included.');
}

export function renderMarkdown({ generatedAt, baseUrl, repo, runContext, summary, checks, canaryActivity }) {
  const hardFailure = summary.fail > 0;
  const credentialLimited = runContext !== 'GitHub Actions' && checks.some((check) => /missing=|skip\(/.test(check.detail));
  const lines = [
    '# SpeakSharp Ops Health',
    '',
    `Generated: ${generatedAt}`,
    `Target: ${baseUrl}`,
    `Repository: ${repo}`,
    `Run context: ${runContext}`,
    '',
    `Verdict: ${hardFailure ? 'ACTION REQUIRED' : 'NO HARD FAILURES IN CHECKS THAT RAN'}`,
    `Coverage: ${summary.pass} ok / ${summary.warn} review / ${summary.fail} fail / ${summary.skip} not checked`,
  ];

  if (credentialLimited) {
    lines.push(
      '',
      '> This local run is not authoritative for vendor credentials because GitHub Actions secrets are not available in the local shell. Use the GitHub Ops Health workflow for the secret-backed view.',
    );
  }

  lines.push('', '| Area | Status | Meaning | Evidence | Next Action | Drill-down |', '|---|---|---|---|---|---|');

  for (const check of checks) {
    if (check.github) {
      const { repository, actions, actionsUrl } = check.github;
      const status = repository === 'fail' || actions === 'fail' ? 'fail'
        : repository === 'pass' && actions === 'pass' ? 'pass' : 'warn';
      const read = { pass: 'readable', fail: 'could not read', skip: 'not checked', warn: 'partially readable' };
      lines.push(['GitHub access', statusBadge({ status }), 'Repository and workflow run lists',
        'Repository: ' + read[repository] + '; Actions: ' + read[actions],
        'Workflow outcomes are listed separately below.', actionsUrl ? '[Open Actions](' + actionsUrl + ')' : '',
      ].map(esc).join(' | '));
      continue;
    }
    lines.push(
      [
        esc(check.name),
        esc(statusBadge(check)),
        esc(check.question),
        esc(check.detail),
        esc(nextAction(check, runContext)),
        check.drilldownUrl ? `[Open](${check.drilldownUrl})` : '',
      ].join(' | '),
    );
  }

  const gh = checks.find((check) => check.github)?.github;
  if (gh?.workflows?.length) {
    lines.push('', '## SpeakSharp workflow results', '', 'These results affect release readiness, not GitHub availability.');
    const names = { ci: 'Latest CI', canary: 'Latest canary', release: 'Full live release gate on main' };
    const outcomes = { passed: 'passed', failed: 'failed', pending: 'in progress', missing: 'no qualifying run', unavailable: 'could not read' };
    for (const item of gh.workflows) {
      const scope = item.branch === 'other' ? ' (other branch)' : item.branch === 'main' && item.kind !== 'release' ? ' (main)' : '';
      lines.push('- ' + names[item.kind] + scope + ': ' + outcomes[item.outcome]
        + (item.runAt ? ' · recorded ' + item.runAt : '') + (item.url ? ' · [Open in Actions](' + item.url + ')' : ''));
    }
  }

  if (canaryActivity) renderCanaryActivity(lines, canaryActivity);

  lines.push(
    '',
    '## How To Read This',
    '',
    '- `OK` means the check ran and passed.',
    '- `REVIEW` means no hard outage was proven, but freshness, optional credentials, or external status needs attention.',
    '- `FAIL` means a launch-relevant dependency or workflow is red.',
    '- `NOT READY` means the check could not produce a useful signal yet, usually because this run lacks credentials or the integration is intentionally deferred.',
    '',
    '> Keep this dashboard simple. It is an early warning board, not a replacement for vendor dashboards.',
  );
  return `${lines.join('\n')}\n`;
}

const PUBLIC_GEMINI_GENERATION = new Set(['Gemini generation', 'Gemini highest working model']);
const PUBLIC_GEMINI_VERSION = /^gemini-\d{1,3}\.\d{1,3}-flash(?:-lite)?(?:-\d{3})?$/;

export function renderPublicSummary({ generatedAt, baseUrl, repo, runContext, summary, checks, canaryActivity }) {
  return {
    generatedAt,
    baseUrl,
    repo,
    runContext,
    summary,
    ...(canaryActivity ? { canaryActivity } : {}),
    verdict: summary.fail > 0 ? 'ACTION REQUIRED' : 'NO HARD FAILURES',
    checks: checks.map((check) => ({
      name: check.name,
      status: check.status,
      label: verdictLabel(check),
      icon: statusIcon(check),
      question: check.question,
      evidence: check.detail,
      nextAction: nextAction(check, runContext),
      latencyMs: check.latencyMs,
      checkedAt: check.checkedAt,
      drilldownUrl: check.drilldownUrl,
      ...(check.github ? { github: check.github } : {}),
      ...(PUBLIC_GEMINI_GENERATION.has(check.name) && check.status === 'pass'
        && typeof check.providerModelVersion === 'string' && PUBLIC_GEMINI_VERSION.test(check.providerModelVersion)
        ? { providerModelVersion: check.providerModelVersion } : {}),
      ...(check.name === 'Gemini generation' && typeof check.configuredModelVersion === 'string'
        && /^gemini-[a-z0-9][a-z0-9.-]{0,58}$/.test(check.configuredModelVersion)
        ? { configuredModelVersion: check.configuredModelVersion } : {}),
      ...(check.name === 'Gemini generation'
        && ['not_checked', 'checking', 'verified', 'unavailable'].includes(check.coachingReadiness)
        ? { coachingReadiness: check.coachingReadiness } : {}),
    })),
  };
}
