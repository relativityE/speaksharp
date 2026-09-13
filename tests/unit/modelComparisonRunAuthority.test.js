import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZATION_FILE_NAME, AUTHORIZATION_JOB_NAME, AUTHORIZATION_WORKFLOW_PATH, DIAGNOSTIC_JOB_NAME, COMPARISON_CELLS, RUN_AUTHORIZATION_VERSION, PRODUCTION_ORIGIN,
  authorizationArtifactName, checkRunAuthority, ghRunArtifactFetcher, githubApiGetter, loadRunAuthority, mintRunAuthorization,
  parseComparisonCell, verifyRunAuthorization,
} from '../../scripts/human-test/modelComparisonRunAuthority.mjs';

const REPO = 'relativityE/speaksharp';
const OWNER = 'relativityE';
const RELEASE = 'a'.repeat(40);
/** workflow_dispatch against the exact candidate head: the executed revision IS the release (PM 5651842972). */
const WORKFLOW_SHA = RELEASE;
const WORKFLOW_REF = `${REPO}/.github/workflows/rc-gates.yml@refs/heads/main`;
const RUN_ID = 812345;
const ISSUED_AT = Date.parse('2026-09-13T12:00:00.000Z');
const DOCUMENT = '11111111-1111-4111-8111-111111111111';
const EXPECTED = { candidateId: 'v4:distil:q4', journey: 'focus_points', releaseSha: RELEASE, origin: PRODUCTION_ORIGIN, evidenceDocumentId: DOCUMENT };

const mint = (overrides = {}) => mintRunAuthorization({
  repository: REPO, ref: 'refs/heads/main', workflowRef: WORKFLOW_REF, workflowSha: WORKFLOW_SHA, sha: RELEASE,
  owner: OWNER, actor: OWNER, triggeringActor: OWNER, runId: RUN_ID, runAttempt: 1, releaseSha: RELEASE,
  cell: 'v4:distil:q4/focus_points', evidenceDocumentId: DOCUMENT, randomHex: '0123456789abcdef01234567', now: ISSUED_AT,
  ...overrides,
});
/** GitHub's readback of the attempt: `terminal` is a completed authorization run; `in_run` is the executing diagnostic. */
const bundle = (artifact = mint(), phase = 'terminal') => ({
  artifact,
  repo: { full_name: REPO, default_branch: 'main', owner: { login: OWNER } },
  jobs: phase === 'terminal'
    ? [
      { name: 'Gate 1 - Product Truth', status: 'completed', conclusion: 'skipped' },
      { name: AUTHORIZATION_JOB_NAME, status: 'completed', conclusion: 'success' },
      { name: 'Gate 5 - UX Smoke', status: 'completed', conclusion: 'skipped' },
    ]
    : [{ name: DIAGNOSTIC_JOB_NAME, status: 'in_progress', conclusion: null }],
  run: {
    id: RUN_ID, run_attempt: 1, repository: { full_name: REPO }, path: AUTHORIZATION_WORKFLOW_PATH, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: WORKFLOW_SHA,
    status: phase === 'terminal' ? 'completed' : 'in_progress', conclusion: phase === 'terminal' ? 'success' : null,
    actor: { login: OWNER }, triggering_actor: { login: OWNER },
    run_started_at: new Date(ISSUED_AT - 10_000).toISOString(), updated_at: new Date(ISSUED_AT + 20_000).toISOString(),
  },
});
const check = (b, overrides = {}) => checkRunAuthority({ record: b.artifact, ...b, at: ISSUED_AT + 60_000, ...overrides });

describe('#1432 PM decisions 5651830241 / 5651842972 — minting one cell\'s authorization inside the owner-dispatched rc-gates.yml run', () => {
  it('CONTROL: binds repository, workflow path/ref/revision, run attempt, actor, release, origin, cell and document — with no expiry', () => {
    const artifact = mint();
    expect(artifact).toEqual({
      schemaVersion: RUN_AUTHORIZATION_VERSION, repository: REPO, workflowPath: '.github/workflows/rc-gates.yml',
      workflowRef: WORKFLOW_REF, workflowSha: WORKFLOW_SHA, runId: RUN_ID, runAttempt: 1, actor: OWNER, releaseSha: RELEASE,
      origin: PRODUCTION_ORIGIN, candidateId: 'v4:distil:q4', journey: 'focus_points', evidenceDocumentId: DOCUMENT,
      nonce: `run-${RUN_ID}-1-0123456789abcdef01234567`, issuedAt: new Date(ISSUED_AT).toISOString(),
    });
    expect(JSON.stringify(artifact)).not.toMatch(/expires|ttl|key|signature|secret|token/i);
  });

  it('the dispatch vocabulary is exactly the six candidate/journey cells', () => {
    expect(COMPARISON_CELLS).toEqual([
      'v2:base.en/open_mic', 'v2:base.en/focus_points', 'v4:distil:q4/open_mic', 'v4:distil:q4/focus_points',
      'moonshine:streaming-medium/open_mic', 'moonshine:streaming-medium/focus_points',
    ]);
    expect(parseComparisonCell('moonshine:streaming-medium/focus_points')).toEqual({ candidateId: 'moonshine:streaming-medium', journey: 'focus_points' });
    expect(parseComparisonCell('v2:base.en')).toBeNull();
  });

  it('CONTROL: a rerun is a distinct attempt and mints a distinct nonce', () => {
    const rerun = mint({ runAttempt: 2, randomHex: 'fedcba9876543210fedcba98' });
    expect(rerun.nonce).toBe(`run-${RUN_ID}-2-fedcba9876543210fedcba98`);
    expect(rerun.nonce).not.toBe(mint().nonce);
  });

  it.each([
    ['a foreign repository', { repository: 'someone/fork' }, /repository/],
    ['a tag or detached ref', { ref: 'refs/tags/v1', workflowRef: `${REPO}/.github/workflows/rc-gates.yml@refs/tags/v1` }, /dispatched against a branch ref/],
    ['a workflow definition from another ref', { workflowRef: `${REPO}/.github/workflows/rc-gates.yml@refs/heads/feature` }, /dispatched rc-gates\.yml definition/],
    ['another workflow file', { workflowRef: `${REPO}/.github/workflows/ci.yml@refs/heads/main` }, /dispatched rc-gates\.yml definition/],
    ['a release that is not the executed commit', { releaseSha: 'b'.repeat(40) }, /release must be the exact commit this run executes/],
    ['a workflow revision that is not the executed commit', { workflowSha: 'b'.repeat(40) }, /workflow revision must be the full SHA this run executes/],
    ['a non-owner dispatcher', { actor: 'intruder' }, /dispatched and triggered by the repository owner/],
    ['a rerun triggered by a non-owner', { triggeringActor: 'intruder' }, /dispatched and triggered by the repository owner/],
    ['a short release', { releaseSha: 'abc' }, /release/],
    ['a candidate off the slate', { cell: 'v4:base:q4/open_mic' }, /comparison cell/],
    ['a bare candidate without a journey', { cell: 'v2:base.en' }, /comparison cell/],
    ['an evidence document that is not a UUIDv4', { evidenceDocumentId: 'doc-1' }, /evidence document/],
    ['weak nonce entropy', { randomHex: 'abc' }, /entropy/],
  ])('CASUALTY: refuses %s', (_label, overrides, message) => {
    expect(() => mint(overrides)).toThrow(message);
  });

  const runMint = (env) => {
    const dir = mkdtempSync(join(tmpdir(), 'mint-authorization-'));
    const out = join(dir, 'nested', AUTHORIZATION_FILE_NAME);
    const result = spawnSync(process.execPath, ['scripts/human-test/mint-model-comparison-authorization.mjs'], {
      env: {
        PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPO, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: RELEASE,
        GITHUB_WORKFLOW_REF: WORKFLOW_REF, GITHUB_WORKFLOW_SHA: WORKFLOW_SHA, REPOSITORY_OWNER: OWNER, GITHUB_ACTOR: OWNER,
        GITHUB_TRIGGERING_ACTOR: OWNER, GITHUB_RUN_ID: String(RUN_ID), GITHUB_RUN_ATTEMPT: '3', RELEASE_SHA: RELEASE,
        COMPARISON_CELL: 'v2:base.en/open_mic', EVIDENCE_DOCUMENT_ID: DOCUMENT, AUTHORIZATION_OUT: out, ...env,
      },
      encoding: 'utf8',
    });
    const written = existsSync(out) ? { json: JSON.parse(readFileSync(out, 'utf8')), mode: statSync(out).mode & 0o777 } : null;
    rmSync(dir, { recursive: true, force: true });
    return { result, written };
  };

  it('CONTROL: inside the run, the mint script writes a private, content-free authorization from runner context', () => {
    const { result, written } = runMint({});
    expect(result.status).toBe(0);
    expect(written.mode).toBe(0o600);
    expect(written.json).toMatchObject({ runId: RUN_ID, runAttempt: 3, candidateId: 'v2:base.en', journey: 'open_mic', workflowRef: WORKFLOW_REF });
    expect(written.json.nonce).toMatch(new RegExp(`^run-${RUN_ID}-3-[0-9a-f]{24}$`));
  });

  it.each([
    ['outside GitHub Actions', { GITHUB_ACTIONS: '' }, /HOLD: authorizations are minted only inside the rc-gates\.yml run/],
    ['a rerun triggered by a non-owner', { GITHUB_TRIGGERING_ACTOR: 'intruder' }, /HOLD: authorization must be dispatched and triggered by the repository owner/],
    ['a release other than the dispatched head', { RELEASE_SHA: 'b'.repeat(40) }, /HOLD: release must be the exact commit this run executes/],
  ])('CASUALTY: the mint script HOLDs and writes nothing %s', (_label, env, message) => {
    const { result, written } = runMint(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(written).toBeNull();
  });
});

describe('#1432 PM decisions 5651830241 / 5651842972 — trusted check of an authorization against GitHub\'s record of its run attempt', () => {
  it('CONTROL: a completed, successful, owner-dispatched rc-gates.yml attempt at the exact release passes (terminal)', () => {
    expect(check(bundle(), { expected: EXPECTED })).toEqual([]);
  });

  it('CONTROL: the take executing inside its own in-progress attempt passes (in_run)', () => {
    expect(check(bundle(mint(), 'in_run'), { phase: 'in_run', at: ISSUED_AT + 5_000, expected: EXPECTED })).toEqual([]);
  });

  it('CONTROL: there is no wall-clock expiry — reliance two days after the run still passes', () => {
    expect(check(bundle(), { at: ISSUED_AT + 48 * 60 * 60_000, expected: EXPECTED })).toEqual([]);
  });

  it('CONTROL: a run dispatched against the reviewed candidate branch (not main) passes — no pre-merge ancestry rule', () => {
    const ref = 'refs/heads/evidence/production-model-downselection';
    const artifact = mint({ ref, workflowRef: `${REPO}/.github/workflows/rc-gates.yml@${ref}` });
    const b = bundle(artifact);
    b.run.head_branch = 'evidence/production-model-downselection';
    expect(check(b, { expected: EXPECTED })).toEqual([]);
  });

  it.each([
    ['an unreadable artifact', (b) => { b.artifact = null; }, /run artifact could not be read/],
    ['a retired expiry field', (b) => { b.artifact = { ...b.artifact, expiresAt: new Date(ISSUED_AT).toISOString() }; }, /expiresAt is not allowed/],
    ['an extra key field', (b) => { b.artifact = { ...b.artifact, privateKey: 'x' }; }, /privateKey is not allowed/],
    ['a record that differs from the artifact', (b) => { b.record = { ...b.artifact, journey: 'open_mic' }; }, /journey does not match its run artifact/],
    ['another run attempt', (b) => { b.run.run_attempt = 2; }, /run id or attempt does not match GitHub/],
    ['another repository', (b) => { b.run.repository.full_name = 'someone/fork'; }, /run belongs to another repository/],
    ['another workflow', (b) => { b.run.path = '.github/workflows/ci.yml'; }, /not the authorization workflow/],
    ['a definition from another ref than the run executed', (b) => { b.artifact = { ...b.artifact, workflowRef: `${REPO}/.github/workflows/rc-gates.yml@refs/heads/feature` }; b.record = b.artifact; }, /workflow ref does not match the ref its run executed/],
    ['a non-dispatch event', (b) => { b.run.event = 'schedule'; }, /was not a manual dispatch/],
    ['a run on another branch', (b) => { b.run.head_branch = 'evidence/production-model-downselection'; }, /workflow ref does not match the ref its run executed/],
    ['a different executed revision', (b) => { b.run.head_sha = 'd'.repeat(40); }, /workflow revision does not match its run/],
    ['a release that is not the executed revision', (b) => { b.artifact = { ...b.artifact, releaseSha: 'b'.repeat(40) }; b.record = b.artifact; }, /release is not the revision its run executed/],
    ['unreadable jobs', (b) => { b.jobs = null; }, /jobs could not be read from GitHub/],
    ['no authorization job', (b) => { b.jobs = b.jobs.filter((job) => job.name !== AUTHORIZATION_JOB_NAME); }, /no single successful comparison-authorization job/],
    ['a failed authorization job', (b) => { b.jobs.find((job) => job.name === AUTHORIZATION_JOB_NAME).conclusion = 'failure'; }, /no single successful comparison-authorization job/],
    ['a run that also executed a gate', (b) => { b.jobs.push({ name: DIAGNOSTIC_JOB_NAME, status: 'completed', conclusion: 'failure' }); }, /executed jobs other than comparison authorization/],
    ['an unfinished run', (b) => { b.run.status = 'in_progress'; b.run.conclusion = null; }, /did not complete successfully/],
    ['a failed run', (b) => { b.run.conclusion = 'failure'; }, /did not complete successfully/],
    ['a rerun triggered by someone else', (b) => { b.run.triggering_actor = { login: 'intruder' }; }, /actor and triggering actor/],
    ['a non-owner actor', (b) => { b.repo.owner.login = 'org-owner'; }, /not dispatched by the repository owner/],
    ['an issue time outside the run', (b) => { b.run.updated_at = new Date(ISSUED_AT - 120_000).toISOString(); }, /not issued during its run/],
    ['reliance before the run completed', (b) => { b.run.updated_at = new Date(ISSUED_AT + 10 * 60_000).toISOString(); }, /relied on before its run completed/],
    ['a nonce from another run', (b) => { b.artifact = { ...b.artifact, nonce: `run-1-1-${'0'.repeat(24)}` }; b.record = b.artifact; }, /nonce was not generated by its authorization run/],
    ['a nonce from another attempt', (b) => { b.artifact = { ...b.artifact, nonce: `run-${RUN_ID}-2-${'0'.repeat(24)}` }; b.record = b.artifact; }, /nonce was not generated by its authorization run/],
    ['another cell', (b) => { b.artifact = { ...b.artifact, candidateId: 'v2:base.en' }; b.record = b.artifact; }, /candidateId must be "v4:distil:q4"/],
    ['another document', (b) => { b.artifact = { ...b.artifact, evidenceDocumentId: '33333333-3333-4333-8333-333333333333' }; b.record = b.artifact; }, /evidenceDocumentId must be/],
  ])('CASUALTY: refuses %s', (_label, mutate, message) => {
    const b = bundle();
    b.record = b.artifact;
    mutate(b);
    expect(check(b, { record: b.record, expected: EXPECTED }).join('\n')).toMatch(message);
  });

  it('CASUALTY: an in_run reliance on a run that is not executing the diagnostic, or an unknown phase, is refused', () => {
    expect(check(bundle(), { phase: 'in_run', at: ISSUED_AT + 5_000 })).toEqual(expect.arrayContaining([
      'authorization run is not the run executing this take', 'authorization run is not executing the diagnostic job',
    ]));
    expect(check(bundle(), { phase: 'whenever' })).toEqual(['authorization reliance phase is invalid']);
  });

  it('CASUALTY: an authorization relied on before issue is refused', () => {
    expect(check(bundle(mint(), 'in_run'), { phase: 'in_run', at: ISSUED_AT - 120_000 })).toContain('authorization was relied on before it was issued');
  });

  it('loads exactly the run attempt, that attempt\'s jobs and its attempt artifact, and records verifiedAt', async () => {
    const b = bundle();
    const requested = [];
    const githubGet = async (path) => {
      requested.push(path);
      if (path === `repos/${REPO}`) return b.repo;
      if (path === `repos/${REPO}/actions/runs/${RUN_ID}/attempts/1`) return b.run;
      if (path === `repos/${REPO}/actions/runs/${RUN_ID}/attempts/1/jobs?per_page=100`) return { total_count: b.jobs.length, jobs: b.jobs };
      throw new Error(`unexpected ${path}`);
    };
    const fetchRunArtifact = vi.fn(async () => b.artifact);
    const loaded = await loadRunAuthority({ runId: RUN_ID, runAttempt: 1, githubGet, fetchRunArtifact });
    expect(loaded).toEqual({ repo: b.repo, run: b.run, jobs: b.jobs, artifact: b.artifact });
    expect(requested).toEqual([`repos/${REPO}`, `repos/${REPO}/actions/runs/${RUN_ID}/attempts/1`, `repos/${REPO}/actions/runs/${RUN_ID}/attempts/1/jobs?per_page=100`]);
    expect(fetchRunArtifact).toHaveBeenCalledWith(RUN_ID, 1);
    const verified = await verifyRunAuthorization({ runId: RUN_ID, runAttempt: 1, githubGet, fetchRunArtifact, now: ISSUED_AT + 60_000 });
    expect(verified).toMatchObject({ ok: true, problems: [], record: { ...b.artifact, verifiedAt: new Date(ISSUED_AT + 60_000).toISOString() } });
  });

  it('CASUALTY: observer verification refuses a diagnostic run that is still executing', async () => {
    const b = bundle(mint(), 'in_run');
    const githubGet = async (path) => (path.endsWith('/jobs?per_page=100') ? { jobs: b.jobs } : path.includes('/attempts/') ? b.run : b.repo);
    const verified = await verifyRunAuthorization({ runId: RUN_ID, runAttempt: 1, githubGet, fetchRunArtifact: async () => b.artifact, now: ISSUED_AT + 60_000 });
    expect(verified.ok).toBe(false);
    expect(verified.record).toBeNull();
    expect(verified.problems).toContain('authorization run did not complete successfully');
  });

  it('CASUALTY: a run GitHub cannot read yields no record', async () => {
    const verified = await verifyRunAuthorization({
      runId: RUN_ID, runAttempt: 1, githubGet: async () => { throw new Error('404'); }, fetchRunArtifact: async () => null,
    });
    expect(verified).toEqual({ ok: false, problems: ['the authorization run could not be read from GitHub'], record: null });
  });

  it('downloads the artifact of exactly the requested attempt and removes its temp directory', async () => {
    let dir = null;
    const execFile = vi.fn((_gh, args) => {
      dir = args[args.indexOf('--dir') + 1];
      writeFileSync(join(dir, AUTHORIZATION_FILE_NAME), JSON.stringify({ runAttempt: 2 }));
    });
    expect(await ghRunArtifactFetcher(execFile)(RUN_ID, 2)).toEqual({ runAttempt: 2 });
    expect(execFile.mock.calls[0][1]).toEqual(['run', 'download', String(RUN_ID), '--repo', REPO, '--name', 'model-comparison-authorization-attempt-2', '--dir', dir]);
    expect(authorizationArtifactName(2)).toBe('model-comparison-authorization-attempt-2');
    expect(existsSync(dir)).toBe(false);
  });

  it('the fetch getter authenticates and fails closed on a non-OK response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const get = githubApiGetter({ token: 'read-only-token', fetchImpl });
    expect(await get(`repos/${REPO}`)).toEqual({ default_branch: 'main' });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer read-only-token');
    await expect(get('repos/x')).rejects.toThrow(/HTTP 404/);
  });
});

describe('#1432 PM decisions 5651830241 / 5651842972 — workflow contracts: one workflow, one authorization job', () => {
  const rcGates = readFileSync('.github/workflows/rc-gates.yml', 'utf8');
  const runBlocks = (text) => [...text.matchAll(/run: \|\n((?: {10,}.*\n?)+)/g)].map((match) => match[1]).join('\n')
    + [...text.matchAll(/run: (?!\|)(.+)/g)].map((match) => match[1]).join('\n');
  const step = (name) => {
    const start = rcGates.indexOf(`- name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    const next = rcGates.indexOf('\n      - name:', start + 1);
    return rcGates.slice(start, next === -1 ? undefined : next);
  };

  it('CASUALTY: no second authorization workflow exists, and only rc-gates.yml mints', () => {
    expect(existsSync('.github/workflows/model-comparison-authorization.yml')).toBe(false);
    const minting = readdirSync('.github/workflows').filter((file) =>
      readFileSync(join('.github/workflows', file), 'utf8').includes('mint-model-comparison-authorization.mjs'));
    expect(minting).toEqual(['rc-gates.yml']);
  });

  it('dispatch takes one closed cell, the release and the document — no run id, key, pin or envelope input', () => {
    const inputsBlock = rcGates.slice(rcGates.indexOf('workflow_dispatch:'), rcGates.indexOf('\npermissions:'));
    const inputNames = [...inputsBlock.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((match) => match[1]);
    expect(inputNames.filter((name) => name.startsWith('comparison'))).toEqual(['comparison_cell', 'comparison_release_sha', 'comparison_evidence_document_id']);
    expect(inputNames.length).toBeLessThanOrEqual(10);
    const cellBlock = inputsBlock.slice(inputsBlock.indexOf('comparison_cell:'), inputsBlock.indexOf('comparison_release_sha:'));
    expect(cellBlock).toContain('type: choice');
    expect(cellBlock).toContain('default: none');
    expect([...cellBlock.matchAll(/^ {10}- '?([^'\n]+)'?$/gm)].map((match) => match[1])).toEqual(['none', ...COMPARISON_CELLS]);
    expect(rcGates).toMatch(/permissions:\n {2}contents: read\n(?: {2}#.*\n)* {2}actions: read\n\n/);
    expect(rcGates).not.toMatch(/comparison_authorization_run_id|MODEL_COMPARISON_PUBLIC_KEY|VERIFICATION_KEY|PRIVATE_KEY|key-pin|gh run download/);
  });

  it('CASUALTY: comparison inputs reach shell steps only through env, never interpolated into a script', () => {
    expect(runBlocks(rcGates)).not.toMatch(/inputs\.comparison_/);
  });

  const job = (id) => {
    const start = rcGates.indexOf(`\n  ${id}:\n`);
    expect(start).toBeGreaterThan(-1);
    const next = rcGates.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return rcGates.slice(start, next === -1 ? undefined : start + 1 + next);
  };
  const MINT_LINES = [
    'COMPARISON_CELL: ${{ github.event.inputs.comparison_cell }}',
    'RELEASE_SHA: ${{ github.event.inputs.comparison_release_sha }}',
    'EVIDENCE_DOCUMENT_ID: ${{ github.event.inputs.comparison_evidence_document_id }}',
    'REPOSITORY_OWNER: ${{ github.repository_owner }}',
    'set -euo pipefail',
    'if [ "$RELEASE_SHA" != "$GITHUB_SHA" ]; then',
    'node scripts/human-test/mint-model-comparison-authorization.mjs',
  ];

  it('the qualifying gate is one read-only job: exact release, Production serves it, then mint and upload the attempt artifact', () => {
    expect(rcGates).toMatch(/options:\n(?: {10}- .+\n)*? {10}- comparison-authorization\n/);
    const authorization = job('comparison-authorization');
    expect(authorization).toContain(`name: ${AUTHORIZATION_JOB_NAME}`);
    expect(authorization).toContain("if: ${{ github.event.inputs.gate == 'comparison-authorization' }}");
    expect(authorization).toMatch(/permissions:\n {6}contents: read\n {4}steps:/);
    expect(authorization).not.toMatch(/secrets\.|id-token|: write|playwright|pnpm/);
    for (const line of MINT_LINES) expect(authorization).toContain(line);
    for (const line of ['BASE_URL: https://speaksharp-public.vercel.app', 'EXPECTED_RELEASE_SHA: ${{ github.sha }}', 'EVIDENCE_SCOPE: canonical-production']) {
      expect(authorization).toContain(line);
    }
    expect(authorization.indexOf('node scripts/rc-evidence-target-preflight.mjs')).toBeGreaterThan(authorization.indexOf('"$GITHUB_SHA"'));
    expect(authorization.indexOf('node scripts/rc-evidence-target-preflight.mjs')).toBeLessThan(authorization.indexOf('node scripts/human-test/mint-model-comparison-authorization.mjs'));
    expect(authorization).toContain('name: model-comparison-authorization-attempt-${{ github.run_attempt }}');
    expect(authorization).toContain('if-no-files-found: error');
    for (const other of ['gate-1-product', 'gate-2-sast', 'gate-3-dast', 'gate-4-sca', 'gate-5-ux']) {
      expect(job(other)).toMatch(new RegExp(`if: \\$\\{\\{ github\\.event\\.inputs\\.gate == 'all' \\|\\| github\\.event\\.inputs\\.gate == '${other}' \\}\\}`));
    }
    expect(job('gate-3-dast')).toContain(`name: ${DIAGNOSTIC_JOB_NAME}`);
  });

  it('the nonqualifying diagnostic mints in its own job before the spec and keeps its terminal rejection', () => {
    const authorize = step('Authorize the model-comparison cell in this run (DIAGNOSTIC comparison only)');
    expect(authorize).toContain("if: ${{ github.event.inputs.diagnostic_dast_spec != '' && github.event.inputs.comparison_cell != 'none' }}");
    for (const line of MINT_LINES) expect(authorize).toContain(line);
    expect(rcGates.indexOf('- name: Authorize the model-comparison cell')).toBeLessThan(rcGates.indexOf('- name: Run DAST Live Gate (DIAGNOSTIC single spec'));
    expect(step('Reject diagnostic run as release qualification')).toContain('exit 1');
    expect(rcGates).not.toMatch(/default_branch|merge-base|\/compare\//);
  });

  it('the diagnostic receives only this run\'s minted file and a read token, and uploads the attempt\'s content-free authorization', () => {
    const diagnostic = step('Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)');
    expect(diagnostic).toContain("MODEL_COMPARISON_AUTHORIZATION_FILE: ${{ github.event.inputs.comparison_cell != 'none' && format('{0}/model-comparison-authorization/model-comparison-authorization.json', runner.temp) || '' }}");
    expect(diagnostic).toContain('MODEL_COMPARISON_GITHUB_TOKEN: ${{ github.token }}');
    const upload = step('Upload model-comparison authorization (content-free)');
    expect(upload).toContain('name: model-comparison-authorization-attempt-${{ github.run_attempt }}');
    expect(upload).toContain('path: ${{ runner.temp }}/model-comparison-authorization/model-comparison-authorization.json');
    expect(step('Upload canonical Production Gate 3 artifacts')).not.toContain('model-comparison-authorization');
  });

  it('CASUALTY: missing, stale or inconsistent run authority executes zero product qualification', () => {
    const spec = readFileSync('tests/live/practice-loop-journey.live.spec.ts', 'utf8');
    const firstNavigation = spec.indexOf("await page.goto('");
    for (const hold of ["holdNow('comparison_authorization_unreadable'", 'holdNow(authorization.hold', 'loadRunAuthority(']) {
      expect(spec.indexOf(hold)).toBeGreaterThan(-1);
      expect(spec.indexOf(hold)).toBeLessThan(firstNavigation);
    }
    expect(spec).toContain('process.env.GITHUB_RUN_ATTEMPT');
    expect(spec).not.toMatch(/holdBeforeSwitch|MODEL_COMPARISON_AUTHORIZATION_RUN_ID/);
  });
});
