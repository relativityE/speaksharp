#!/usr/bin/env node
/**
 * #1432 PM decisions 5651684739 / 5651830241 / 5651842972 — run ONLY inside `.github/workflows/rc-gates.yml`, in the
 * run that is the take's authorization boundary, dispatched against the exact candidate head.
 *
 * Repository, ref, workflow ref and revision, run id, attempt, actor and triggering actor come from the runner,
 * never from a dispatcher input; the dispatcher supplies only the release, one comparison cell and the evidence
 * document, which are validated here. Any refusal is a HOLD that fails the step, so no product step follows.
 * The artifact is content-free and not a credential; its authority is the run that produced it.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mintRunAuthorization } from './modelComparisonRunAuthority.mjs';

const env = process.env;
try {
  if (env.GITHUB_ACTIONS !== 'true') throw new Error('authorizations are minted only inside the rc-gates.yml run');
  const authorization = mintRunAuthorization({
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    sha: env.GITHUB_SHA,
    owner: env.REPOSITORY_OWNER,
    actor: env.GITHUB_ACTOR,
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    releaseSha: env.RELEASE_SHA,
    cell: env.COMPARISON_CELL,
    evidenceDocumentId: env.EVIDENCE_DOCUMENT_ID,
    randomHex: randomBytes(12).toString('hex'),
  });
  const out = env.AUTHORIZATION_OUT;
  if (!out) throw new Error('AUTHORIZATION_OUT is required');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(authorization, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`authorized run ${authorization.runId} attempt ${authorization.runAttempt} for ${authorization.candidateId}/${authorization.journey}`);
} catch (error) {
  console.error(`HOLD: ${error instanceof Error ? error.message : 'authorization could not be minted'}`);
  process.exit(1);
}
