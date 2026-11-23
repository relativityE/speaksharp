import { createGithubProbe } from './github-ops-row.mjs';

const ATTEMPTS_LIMIT = 10;
const PAGE_SIZE = 100;
const PAGE_LIMIT = 10;
const JOB_NAMES = new Set([
  'read the release production serves', 'verify last released production identity',
  'read-only runtime migration readiness', 'canary-check (active-trial)',
  'canary-check (billing-qualification)', 'canary-result',
]);
const STEP_NAMES = new Set([
  'Set up job', 'Setup Environment', 'Read the served release from production and require it to be a commit on main',
  'Read exact production migration history', 'Evaluate canary runtime prerequisite',
  'Validate protected canary identities', 'Provision Canary User (active-trial)',
  'Create run-owned trial account (active-trial)', 'Verify run-owned trial account (active-trial)',
  'Run Smoke Test (active-trial product path)', 'Run Smoke Test (active-trial product path, run-owned account)',
  'Delete run-owned trial account (active-trial)', 'Canary Account Ceiling (hygiene)',
  'Stripe Test-Mode/Test-Clock Billing Qualification (billing-qualification)', 'Require truthful terminal state',
]);
const PENDING = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const FAILED = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const TRIGGERS = new Map([['schedule', 'scheduled'], ['workflow_dispatch', 'manual'], ['push', 'push']]);
const id = (value) => Number.isSafeInteger(value) && value > 0;
function iso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function reason(conclusion) {
  // GitHub's explicit terminal codes distinguish these cases. Generic failure has no
  // stable identity, even when another failure is reported at the same step.
  return ['timed_out', 'startup_failure', 'action_required'].includes(conclusion) ? conclusion : null;
}

function state(item) {
  if (item.status !== 'completed') return PENDING.has(item.status) ? 'pending' : 'unknown';
  if (item.conclusion === 'success') return 'passed';
  if (FAILED.has(item.conclusion)) return 'failed';
  if (item.conclusion === 'cancelled') return 'cancelled';
  return 'unknown';
}

// GitHub caps filtered run searches at 1,000 results. Fetch every available page, and
// retain partial data if the count changes, a later page fails or the cap is reached.
async function listPages(probe, path, key, label) {
  const records = new Map();
  let expected = null;
  let consistent = true;
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    let body;
    try {
      body = await probe.getJson(`${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`, label);
    } catch {
      return { coverage: page === 1 ? 'unavailable' : 'incomplete', records: [...records.values()] };
    }
    const pageItems = body?.[key];
    if (!Array.isArray(pageItems)) {
      return { coverage: page === 1 ? 'unavailable' : 'incomplete', records: [...records.values()] };
    }
    if (page === 1) expected = body.total_count;
    if (!Number.isSafeInteger(expected) || expected < 0 || body.total_count !== expected) consistent = false;
    for (const item of pageItems.slice(0, PAGE_SIZE)) {
      if (!id(item?.id) || records.has(item.id)) consistent = false;
      else records.set(item.id, item);
    }
    if (pageItems.length < PAGE_SIZE || records.size >= expected) {
      const complete = consistent && pageItems.length <= PAGE_SIZE
        && records.size === expected && records.size < PAGE_SIZE * PAGE_LIMIT;
      return { coverage: complete ? 'complete' : 'incomplete', records: [...records.values()] };
    }
  }
  return { coverage: 'incomplete', records: [...records.values()] };
}

async function failedJobs(probe, repo, proved) {
  if (!proved.attempt) return { failureDetails: 'unavailable', failures: [] };
  try {
    const { coverage, records } = await listPages(
      probe, `/repos/${repo}/actions/runs/${proved.id}/attempts/${proved.attempt}/jobs`, 'jobs', 'canary failed jobs',
    );
    if (coverage === 'unavailable') return { failureDetails: 'unavailable', failures: [] };
    const jobs = records.filter((job) => FAILED.has(job.conclusion));
    const failures = jobs.flatMap((job) => {
      if (!id(job.id)) return [];
      const url = `https://github.com/${repo}/actions/runs/${proved.id}/job/${job.id}`;
      const jobName = JOB_NAMES.has(job.name) ? job.name : 'Other failed job';
      const steps = Array.isArray(job.steps) ? job.steps.filter((step) => step && FAILED.has(step.conclusion)) : [];
      return steps.length ? steps.map((step) => ({
        job: jobName,
        step: STEP_NAMES.has(step.name) ? step.name : 'Other failed step',
        reasonCode: reason(step.conclusion) ?? reason(job.conclusion),
        endedAt: iso(step.completed_at) ?? iso(job.completed_at),
        timeBasis: iso(step.completed_at) ? 'step-completed' : iso(job.completed_at) ? 'job-completed' : null,
        logUrl: id(step.number) ? `${url}#step:${step.number}:1` : url,
      })) : [{
        job: jobName, step: null, reasonCode: reason(job.conclusion), endedAt: iso(job.completed_at),
        timeBasis: iso(job.completed_at) ? 'job-completed' : null, logUrl: url,
      }];
    });
    return {
      failureDetails: failures.length && coverage === 'complete'
        ? 'available' : 'incomplete',
      failures,
    };
  } catch {
    return { failureDetails: 'unavailable', failures: [] };
  }
}

function compareAttempts(a, b) {
  return (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt) || a.id - b.id || a.attempt - b.attempt;
}

function failureEvidence(attempt) {
  const failures = attempt.failures ?? [];
  const upstream = failures.filter(({ job }) => job !== 'canary-result');
  return upstream.length ? upstream : [...failures]
    .sort((a, b) => (a.endedAt ?? 'Z').localeCompare(b.endedAt ?? 'Z')).slice(0, 1);
}

function failureKey(evidence) {
  // Match observable failure locations, not inferred root causes. Never use redacted labels.
  if (!evidence || evidence.job === 'canary-result'
      || !JOB_NAMES.has(evidence.job)) return null;
  if (STEP_NAMES.has(evidence.step)) return JSON.stringify([evidence.job, evidence.step]);
  if (evidence.step === null && evidence.reasonCode) return JSON.stringify([evidence.job, null]);
  return null;
}

function summarizeDay(dateUtc, coverage, attempts) {
  const ordered = attempts.sort(compareAttempts);
  const withoutFailureDetails = ({ failureDetails, failures, ...row }) => row;
  const latest = ordered.at(-1);
  const latestGreen = ordered.filter(({ status }) => status === 'passed').at(-1);
  const failed = ordered.filter(({ status }) => status === 'failed')
    .flatMap((attempt) => {
      const evidence = failureEvidence(attempt);
      const knownTimes = evidence.flatMap((row) => row.endedAt ? [row.endedAt] : []).sort();
      return (evidence.length ? evidence : [null]).map((row) => ({
        attempt: withoutFailureDetails(attempt), evidence: row,
        sortTime: row?.endedAt ?? knownTimes.at(-1) ?? attempt.startedAt ?? attempt.createdAt,
      }));
    })
    .sort((a, b) => a.sortTime.localeCompare(b.sortTime)
      || Number(!a.evidence?.endedAt) - Number(!b.evidence?.endedAt))
    .map(({ attempt, evidence }) => ({ attempt, evidence }));
  const [firstFailure = null, ...later] = failed;
  const distinct = [];
  const unclassified = new Set();
  const firstKey = failureKey(firstFailure?.evidence);
  const known = new Map(firstKey ? [[firstKey, new Set(firstFailure.evidence.reasonCode ? [firstFailure.evidence.reasonCode] : [])]] : []);
  for (const row of later) {
    const key = failureKey(row.evidence);
    if (!key) unclassified.add(`${row.attempt.id}/${row.attempt.attempt}`);
    else {
      const code = row.evidence.reasonCode;
      const codes = known.get(key);
      if (!codes || (code && codes.size && !codes.has(code))) distinct.push(row);
      if (!codes) known.set(key, new Set(code ? [code] : []));
      else if (code) codes.add(code);
    }
  }
  const unclassifiedFailures = unclassified.size;
  return {
    dateUtc, coverage, noRuns: coverage === 'complete' && !latest,
    latest: latest ? withoutFailureDetails(latest) : null,
    latestGreen: latestGreen ? withoutFailureDetails(latestGreen) : null,
    firstFailure, distinct, unclassifiedFailures,
  };
}

function toAttempt(meta, repo, run, attempt) {
  const url = 'https://github.com/' + repo + '/actions/runs/' + run.id;
  return {
    id: run.id, attempt,
    trigger: TRIGGERS.get(run.event) ?? 'other',
    createdAt: iso(run.created_at), startedAt: iso(meta.run_started_at), status: state(meta),
    runUrl: attempt ? url + '/attempts/' + attempt : url,
  };
}

// List original runs created on this UTC date, then read their same-day attempts.
// A retry of a run originally created on an earlier date is outside this snapshot.
export async function evaluateCanaryActivity(repo, token, generatedAt, deps = {}, options = {}) {
  const dateUtc = generatedAt.slice(0, 10);
  const empty = summarizeDay(dateUtc, 'unavailable', []);
  if (!token || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return empty;
  const probe = createGithubProbe(token, deps, options);
  const batchSize = 8;
  try {
    const list = await listPages(probe, '/repos/' + repo + '/actions/workflows/canary.yml/runs?created=' + dateUtc,
      'workflow_runs', 'canary activity UTC day');
    if (list.coverage === 'unavailable') return empty;
    let coverage = list.coverage;
    const attempts = [];
    for (let offset = 0; offset < list.records.length; offset += batchSize) {
      const batch = list.records.slice(offset, offset + batchSize);
      const results = await Promise.all(batch.map(async (run) => {
        if (iso(run.created_at)?.slice(0, 10) !== dateUtc) return { complete: false, rows: [] };
        const latestAttempt = id(run.run_attempt) ? run.run_attempt : null;
        const rows = [toAttempt(run, repo, run, latestAttempt)];
        let complete = latestAttempt !== null && latestAttempt <= ATTEMPTS_LIMIT;
        for (let attempt = Math.max(1, (latestAttempt ?? 1) - ATTEMPTS_LIMIT + 1); attempt < latestAttempt; attempt += 1) {
          try {
            const prior = await probe.getJson('/repos/' + repo + '/actions/runs/' + run.id + '/attempts/' + attempt,
              'prior canary attempt');
            if (prior?.id !== run.id || prior?.run_attempt !== attempt) { complete = false; continue; }
            rows.push(toAttempt(prior, repo, run, attempt));
          } catch {
            complete = false;
          }
        }
        if (rows.some(({ attempt, startedAt }) => attempt !== 1 && !startedAt)) complete = false;
        return { complete, rows: rows.filter(({ startedAt }) => !startedAt || startedAt.slice(0, 10) === dateUtc) };
      }));
      for (const result of results) {
        if (!result.complete) coverage = 'incomplete';
        attempts.push(...result.rows);
      }
    }
    const failed = attempts.filter(({ status }) => status === 'failed');
    for (let offset = 0; offset < failed.length; offset += batchSize) {
      await Promise.all(failed.slice(offset, offset + batchSize)
        .map(async (row) => Object.assign(row, await failedJobs(probe, repo, row))));
    }
    return summarizeDay(dateUtc, coverage, attempts);
  } catch {
    return empty;
  }
}
