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

export function renderMarkdown({ generatedAt, baseUrl, repo, runContext, summary, checks }) {
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

export function renderPublicSummary({ generatedAt, baseUrl, repo, runContext, summary, checks }) {
  return {
    generatedAt,
    baseUrl,
    repo,
    runContext,
    summary,
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
    })),
  };
}
