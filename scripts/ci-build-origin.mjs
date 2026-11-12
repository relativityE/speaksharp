import { createHash } from 'node:crypto';
const SHA = /^[a-f0-9]{40}$/;
const ID = (value) => Number.isSafeInteger(value) && value > 0;
const fail = () => { throw new Error('BUILD_REUSE_UNTRUSTED_ORIGIN'); };

// apiRun and apiArtifact MUST come from authenticated GitHub API responses, never
// from the ZIP/receipt. This policy is not a signature verifier or an API client.
// expected is consumer-owned policy, not values copied from the candidate.
export function verifyArtifactOrigin({ apiRun: run, apiArtifact: artifact, archive, expected }) {
  if (!run || !artifact || !expected || !Buffer.isBuffer(archive)) fail();
  const { repositoryId, repository, workflowId, workflowPath, artifactName, sourceSha, runId, attempt, artifactId } = expected;
  if (![repositoryId, workflowId, runId, attempt, artifactId].every(ID) || !SHA.test(sourceSha || '')
    || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || workflowPath !== '.github/workflows/ci.yml'
    || !artifactName) fail();
  if (run.id !== runId || run.run_attempt !== attempt || run.workflow_id !== workflowId
    || run.path !== workflowPath || run.repository?.id !== repositoryId || run.repository?.full_name !== repository
    || run.head_repository?.id !== repositoryId || !['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main'
    || run.head_sha !== sourceSha || run.status !== 'completed' || run.conclusion !== 'success') fail();
  const origin = artifact.workflow_run;
  if (artifact.id !== artifactId || artifact.name !== artifactName || artifact.expired !== false
    || !origin || origin.id !== runId || origin.repository_id !== repositoryId
    || origin.head_repository_id !== repositoryId || origin.head_branch !== 'main' || origin.head_sha !== sourceSha
    || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')
    || artifact.digest !== `sha256:${createHash('sha256').update(archive).digest('hex')}`) fail();
  // The archive payload still needs safe extraction, input/output byte validation,
  // and installed-runtime verification. Origin alone does not permit a cache hit.
  return { repository, sourceSha, runId, attempt, artifactId, digest: artifact.digest };
}

// Build dependency evidence must come from the trusted producer. Include every
// bundler module, watched input, glob root and explicit build-control input.
// Directory snapshots are required: an added glob match can change a bundle even
// when all previously seen module bytes match. Incomplete graph => rebuild.
export function canReuseBuild({ producer, consumer }) {
  if (!producer || !consumer || producer.schema !== 1 || consumer.schema !== 1
    || producer.complete !== true || consumer.complete !== true) return false;
  for (const key of ['toolchain', 'environment', 'controls', 'modules', 'watched', 'globTrees', 'runtimeBindings']) {
    if (!/^[a-f0-9]{64}$/.test(producer[key] || '') || producer[key] !== consumer[key]) return false;
  }
  return true;
}
