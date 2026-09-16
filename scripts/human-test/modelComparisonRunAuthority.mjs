/**
 * #1432 — the MVP authorization boundary for the three-model comparison is an AUTHENTICATED GITHUB RUN, not a key
 * (Product Owner decision 5651663038; PM decisions 5651684739, 5651830241 and 5651842972).
 *
 * The repository owner dispatches the existing `.github/workflows/rc-gates.yml` against the EXACT reviewed candidate
 * head for ONE comparison cell. Its `comparison-authorization` job refuses unless the requested release is exactly
 * the commit the run executes and the one Production serves, and the owner dispatched and triggered the run; it then
 * mints the one-use `comparison_nonce` bound to the repository, workflow path/ref/revision, run id, run attempt,
 * actor, release, Production origin, cell and evidence document. There is no wall-clock expiry: one run attempt
 * authorizes one cell, and a rerun is a new attempt with a new nonce. Nothing here is secret or signed; authority is
 * GitHub's own record of the run. Main ancestry is a post-merge closure gate, not a pre-merge authorization rule.
 *
 * The spoken take executes on the Product Owner's device. Before arming, the trusted observer live-reads the
 * completed, successful attempt and its jobs (`phase: 'terminal'`); the terminal validator re-reads it. The #1437
 * fixture diagnostic is nonqualifying: it mints inside its own Gate 3 job and reads its in-progress attempt
 * (`phase: 'in_run'`). A browser claim, a locally written authorization or any other run never qualifies.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RUN_AUTHORIZATION_VERSION = 'speaksharp-model-comparison-run-authorization-v1';
export const AUTHORIZATION_WORKFLOW_PATH = '.github/workflows/rc-gates.yml';
export const AUTHORIZATION_FILE_NAME = 'model-comparison-authorization.json';
export const MODEL_COMPARISON_REPOSITORY = 'relativityE/speaksharp';
export const PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';
export const CLOCK_SKEW_MS = 30_000;
/** The one job a qualifying authorization attempt runs; every other rc-gates.yml job must be skipped. */
export const AUTHORIZATION_JOB_NAME = 'Model Comparison Authorization';
/** The job the nonqualifying #1437 diagnostic executes in. */
export const DIAGNOSTIC_JOB_NAME = 'Gate 3 - DAST / Running App';

/**
 * #1477 P1 — TWO SETS, AND THEY ARE NOT THE SAME SET.
 *
 * The Product Owner decision is v4 provisional primary against v2 fallback, with Moonshine DEFERRED until
 * after RWT or MVP. So the matrix a new dispatch may name is the four v2/v4 cells. Moonshine is not one of
 * them and must never become newly dispatchable or newly required.
 *
 * But existing Moonshine evidence has to keep parsing: its raw long-form failure observation is the reason
 * for the deferral, and a parser that rejected those cells would quietly destroy the evidence behind the
 * decision. Historical parseability is therefore a strictly WIDER set than dispatch authority, and being in
 * it authorises nothing.
 */
export const AUTHORIZED_CANDIDATES = Object.freeze(['v2:base.en', 'v4:distil:q4']);
/**
 * WHICH ROLE each authorised candidate holds, not merely which are present.
 *
 * The decision is v4 provisional primary against v2 fallback. Checking only that both are present and
 * distinct lets a packet declare the OPPOSITE roles and still qualify, which would let terminal evidence
 * certify the reverse of the decision it exists to confirm.
 */
export const DECIDED_PRIMARY = 'v4:distil:q4';
export const DECIDED_FALLBACK = 'v2:base.en';
/** Deferred: parseable as history, never dispatchable. */
const HISTORICAL_ONLY_CANDIDATES = Object.freeze(['moonshine:streaming-medium']);
const JOURNEYS = Object.freeze(['open_mic', 'focus_points']);
const cellsFor = (candidates) => candidates.flatMap((candidate) => JOURNEYS.map((journey) => `${candidate}/${journey}`));
/** The four closed `candidate/journey` values a dispatch may name. */
export const COMPARISON_CELLS = Object.freeze(cellsFor(AUTHORIZED_CANDIDATES));
/** Every cell that PARSES, including deferred-candidate cells carried by existing evidence. */
export const HISTORICAL_COMPARISON_CELLS = Object.freeze([...COMPARISON_CELLS, ...cellsFor(HISTORICAL_ONLY_CANDIDATES)]);
/** True only for a cell a NEW dispatch may name. Parseability is never sufficient. */
export const isDispatchableComparisonCell = (cell) => COMPARISON_CELLS.includes(cell);
const SHA40 = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const REF = /^refs\/heads\/[A-Za-z0-9._/-]{1,255}$/;
/** Run-generated nonces carry their run and attempt, so a nonce cannot be lifted onto another run or attempt. */
const RUN_NONCE = /^run-(\d{1,20})-(\d{1,4})-([0-9a-f]{24})$/;
const PHASES = new Set(['terminal', 'in_run']);

export const AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt', 'actor',
  'releaseSha', 'origin', 'candidateId', 'journey', 'evidenceDocumentId', 'nonce', 'issuedAt',
]);
export const RECORD_KEYS = Object.freeze([...AUTHORIZATION_KEYS, 'verifiedAt']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const positiveInt = (value) => Number.isInteger(value) && value > 0;
/** The only workflow ref an authorization may carry: this repository's rc-gates.yml at the dispatched ref. */
const workflowRefFor = (ref) => `${MODEL_COMPARISON_REPOSITORY}/${AUTHORIZATION_WORKFLOW_PATH}@${ref}`;

/** Artifact name for one run attempt; a rerun uploads under its own attempt. */
export const authorizationArtifactName = (runAttempt) => `model-comparison-authorization-attempt-${runAttempt}`;

/**
 * Split one known comparison cell into its candidate and journey, or null.
 *
 * Deliberately parses the HISTORICAL set, so evidence naming a deferred candidate still reads. Callers that
 * are authorising work must additionally require `isDispatchableComparisonCell`.
 */
export function parseComparisonCell(cell) {
  if (!HISTORICAL_COMPARISON_CELLS.includes(cell)) return null;
  const separator = cell.lastIndexOf('/');
  return { candidateId: cell.slice(0, separator), journey: cell.slice(separator + 1) };
}

/**
 * Mint the authorization inside the dispatched run. Every provenance value comes from runner context; the
 * dispatcher supplies only release, cell and evidence document. Throws (HOLD) on any refusal.
 */
export function mintRunAuthorization({
  repository, ref, workflowRef, workflowSha, sha, owner, actor, triggeringActor, runId, runAttempt,
  releaseSha, cell, evidenceDocumentId, randomHex, now = Date.now(),
}) {
  if (repository !== MODEL_COMPARISON_REPOSITORY) throw new Error('repository is not the comparison repository');
  if (!REF.test(ref ?? '')) throw new Error('authorization must be dispatched against a branch ref');
  if (workflowRef !== workflowRefFor(ref)) throw new Error('authorization must run from the dispatched rc-gates.yml definition');
  if (!SHA40.test(workflowSha ?? '') || workflowSha !== sha) throw new Error('workflow revision must be the full SHA this run executes');
  if (!LOGIN.test(owner ?? '') || actor !== owner || triggeringActor !== owner) {
    throw new Error('authorization must be dispatched and triggered by the repository owner');
  }
  if (!positiveInt(runId) || !positiveInt(runAttempt)) throw new Error('run id and attempt must be positive integers');
  if (!SHA40.test(releaseSha ?? '')) throw new Error('release must be a full lowercase git SHA');
  if (releaseSha !== sha) throw new Error('release must be the exact commit this run executes');
  const parsed = parseComparisonCell(cell);
  if (!parsed) throw new Error('comparison cell must be a known candidate/journey cell');
  // Parseable is not dispatchable: a deferred candidate reads as history and is refused here.
  if (!isDispatchableComparisonCell(cell)) {
    throw new Error(`comparison cell ${cell} is not authorized for dispatch: its candidate is deferred until after RWT or MVP`);
  }
  if (!UUID_V4.test(evidenceDocumentId ?? '')) throw new Error('evidence document must be a lowercase UUIDv4');
  if (!/^[0-9a-f]{24}$/.test(randomHex ?? '')) throw new Error('nonce entropy must be 24 lowercase hex characters');
  return {
    schemaVersion: RUN_AUTHORIZATION_VERSION,
    repository,
    workflowPath: AUTHORIZATION_WORKFLOW_PATH,
    workflowRef,
    workflowSha,
    runId,
    runAttempt,
    actor,
    releaseSha,
    origin: PRODUCTION_ORIGIN,
    candidateId: parsed.candidateId,
    journey: parsed.journey,
    evidenceDocumentId,
    nonce: `run-${runId}-${runAttempt}-${randomHex}`,
    issuedAt: new Date(now).toISOString(),
  };
}

/** Structural problems of an authorization (or, with `keys = RECORD_KEYS`, a receipt record). */
export function authorizationShapeProblems(value, keys = AUTHORIZATION_KEYS) {
  if (!isObject(value)) return ['authorization must be an object'];
  const problems = [];
  for (const key of keys) if (!Object.hasOwn(value, key)) problems.push(`authorization.${key} is missing`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) problems.push(`authorization.${key} is not allowed`);
  if (value.schemaVersion !== RUN_AUTHORIZATION_VERSION) problems.push('authorization schemaVersion is invalid');
  if (value.workflowPath !== AUTHORIZATION_WORKFLOW_PATH) problems.push('authorization workflowPath is not the authorization workflow');
  const ref = typeof value.workflowRef === 'string' ? value.workflowRef.slice(value.workflowRef.indexOf('@') + 1) : undefined;
  if (!REF.test(ref ?? '') || value.workflowRef !== workflowRefFor(ref)) problems.push('authorization workflowRef is invalid');
  if (!SHA40.test(value.workflowSha ?? '')) problems.push('authorization workflowSha is invalid');
  if (!positiveInt(value.runId) || !positiveInt(value.runAttempt)) problems.push('authorization run id or attempt is invalid');
  if (!LOGIN.test(value.actor ?? '')) problems.push('authorization actor is invalid');
  if (!SHA40.test(value.releaseSha ?? '')) problems.push('authorization releaseSha is invalid');
  else if (value.releaseSha !== value.workflowSha) problems.push('authorization release is not the revision its run executed');
  // Authorised, not merely parseable: a stored authorization for a deferred candidate is not valid input
  // to a required packet. Historical cells still parse via `parseComparisonCell`.
  if (!AUTHORIZED_CANDIDATES.includes(value.candidateId)) problems.push('authorization candidate is not in the authorised comparison slate');
  if (!JOURNEYS.includes(value.journey)) problems.push('authorization journey is invalid');
  if (!UUID_V4.test(value.evidenceDocumentId ?? '')) problems.push('authorization evidenceDocumentId is invalid');
  const nonce = RUN_NONCE.exec(value.nonce ?? '');
  if (!nonce || Number(nonce[1]) !== value.runId || Number(nonce[2]) !== value.runAttempt) {
    problems.push('authorization nonce was not generated by its authorization run');
  }
  if (!isIso(value.issuedAt)) problems.push('authorization issuedAt is invalid');
  if (keys === RECORD_KEYS && !isIso(value.verifiedAt)) problems.push('authorization verifiedAt must be an ISO instant');
  return problems;
}

/**
 * Pure check of one authorization against GitHub's own record of its run attempt. `record` is what is relied on
 * (a receipt's record, or the artifact itself before arming); `artifact` is what the run minted; `repo`, `run`
 * (that exact attempt) and `jobs` (that attempt's jobs) are live API readbacks; `at` is the moment of reliance.
 * `phase: 'terminal'` requires a completed, successful attempt that ran only the authorization job, relied on after
 * it completed; `phase: 'in_run'` is the nonqualifying diagnostic executing inside the attempt that minted it.
 */
export function checkRunAuthority({ record, artifact, repo, run, jobs, expected = {}, at, phase = 'terminal' }) {
  const problems = [];
  if (!PHASES.has(phase)) return ['authorization reliance phase is invalid'];
  if (!isObject(artifact)) return ['the authorization run artifact could not be read'];
  problems.push(...authorizationShapeProblems(artifact));
  if (!isObject(record)) return [...problems, 'no authorization record was relied on'];
  for (const key of AUTHORIZATION_KEYS) {
    if (record[key] !== artifact[key]) problems.push(`authorization ${key} does not match its run artifact`);
  }

  if (!isObject(repo) || repo.full_name !== MODEL_COMPARISON_REPOSITORY || artifact.repository !== MODEL_COMPARISON_REPOSITORY) {
    problems.push('authorization repository is not the comparison repository');
  }
  const owner = repo?.owner?.login;
  const issued = Date.parse(artifact.issuedAt);
  if (!isObject(run)) {
    problems.push('the authorization run could not be read from GitHub');
  } else {
    if (run.id !== artifact.runId || run.run_attempt !== artifact.runAttempt) problems.push('authorization run id or attempt does not match GitHub');
    if (run.repository?.full_name !== MODEL_COMPARISON_REPOSITORY) problems.push('authorization run belongs to another repository');
    if (run.path !== AUTHORIZATION_WORKFLOW_PATH) problems.push('authorization run is not the authorization workflow');
    if (run.event !== 'workflow_dispatch') problems.push('authorization run was not a manual dispatch');
    if (typeof run.head_branch !== 'string' || artifact.workflowRef !== workflowRefFor(`refs/heads/${run.head_branch}`)) {
      problems.push('authorization workflow ref does not match the ref its run executed');
    }
    if (run.head_sha !== artifact.workflowSha || run.head_sha !== artifact.releaseSha) problems.push('authorization workflow revision does not match its run');
    if (phase === 'terminal' && (run.status !== 'completed' || run.conclusion !== 'success')) {
      problems.push('authorization run did not complete successfully');
    }
    if (phase === 'in_run' && run.status !== 'in_progress') problems.push('authorization run is not the run executing this take');
    if (run.actor?.login !== artifact.actor || run.triggering_actor?.login !== artifact.actor) {
      problems.push('authorization actor does not match the run\'s actor and triggering actor');
    }
    if (typeof owner !== 'string' || artifact.actor !== owner) problems.push('authorization was not dispatched by the repository owner');
    const started = Date.parse(run.run_started_at);
    const ended = phase === 'terminal' ? Date.parse(run.updated_at) : at;
    if (!Number.isFinite(started) || !Number.isFinite(ended)
      || issued < started - CLOCK_SKEW_MS || issued > ended + CLOCK_SKEW_MS) {
      problems.push('authorization was not issued during its run');
    }
    if (phase === 'terminal' && Number.isFinite(at) && at < Date.parse(run.updated_at) - CLOCK_SKEW_MS) {
      problems.push('authorization was relied on before its run completed');
    }
  }
  if (!Array.isArray(jobs)) {
    problems.push('the authorization run jobs could not be read from GitHub');
  } else if (phase === 'terminal') {
    const authorizing = jobs.filter((job) => job?.name === AUTHORIZATION_JOB_NAME);
    if (authorizing.length !== 1 || authorizing[0].status !== 'completed' || authorizing[0].conclusion !== 'success') {
      problems.push('authorization run has no single successful comparison-authorization job');
    }
    if (jobs.some((job) => job?.name !== AUTHORIZATION_JOB_NAME && job?.conclusion !== 'skipped')) {
      problems.push('authorization run executed jobs other than comparison authorization');
    }
  } else if (!jobs.some((job) => job?.name === DIAGNOSTIC_JOB_NAME && job?.status === 'in_progress')) {
    problems.push('authorization run is not executing the diagnostic job');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (artifact[field] !== value) problems.push(`authorization ${field} must be ${JSON.stringify(value)}`);
  }
  if (!Number.isFinite(at)) problems.push('authorization reliance time is invalid');
  else if (at < issued - CLOCK_SKEW_MS) problems.push('authorization was relied on before it was issued');
  return problems;
}

/** Read a run attempt's authority from GitHub: repository, the exact attempt, that attempt's jobs, and its artifact. */
export async function loadRunAuthority({ runId, runAttempt, githubGet, fetchRunArtifact, repository = MODEL_COMPARISON_REPOSITORY }) {
  if (!positiveInt(runId) || !positiveInt(runAttempt)) throw new Error('authorization run id and attempt must be positive integers');
  const repo = await githubGet(`repos/${repository}`);
  const run = await githubGet(`repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}`);
  const jobs = (await githubGet(`repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`))?.jobs ?? null;
  const artifact = await fetchRunArtifact(runId, runAttempt);
  return { repo, run, jobs, artifact };
}

/** Load and check a completed run authorization now; `record` is written to a receipt only when `ok`. */
export async function verifyRunAuthorization({ runId, runAttempt, githubGet, fetchRunArtifact, expected = {}, now = Date.now() }) {
  let bundle;
  try {
    bundle = await loadRunAuthority({ runId, runAttempt, githubGet, fetchRunArtifact });
  } catch {
    return { ok: false, problems: ['the authorization run could not be read from GitHub'], record: null };
  }
  const problems = checkRunAuthority({ record: bundle.artifact, ...bundle, expected, at: now, phase: 'terminal' });
  const ok = problems.length === 0;
  return {
    ok,
    problems,
    record: ok
      ? { ...Object.fromEntries(AUTHORIZATION_KEYS.map((key) => [key, bundle.artifact[key]])), verifiedAt: new Date(now).toISOString() }
      : null,
  };
}

/** Authenticated GitHub REST GET over fetch (live diagnostic). */
export function githubApiGetter({ token = null, fetchImpl = fetch, apiBase = 'https://api.github.com' } = {}) {
  return async (path) => {
    const response = await fetchImpl(`${apiBase}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    return response.json();
  };
}

/** GitHub REST GET through an authenticated `gh` CLI (observer and terminal validator). */
export function ghCliGetter(execFile, gh = 'gh') {
  return async (path) => JSON.parse(execFile(gh, ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

/** Download one run attempt's authorization artifact through `gh run download` into a private temp directory. */
export function ghRunArtifactFetcher(execFile, gh = 'gh', repository = MODEL_COMPARISON_REPOSITORY) {
  return async (runId, runAttempt) => {
    const dir = mkdtempSync(join(tmpdir(), 'model-comparison-authorization-'));
    try {
      execFile(gh, ['run', 'download', String(runId), '--repo', repository, '--name', authorizationArtifactName(runAttempt), '--dir', dir], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return JSON.parse(readFileSync(join(dir, AUTHORIZATION_FILE_NAME), 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
