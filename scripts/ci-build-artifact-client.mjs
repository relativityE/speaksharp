// Read-only GitHub provenance client. The ZIP never supplies its own authority.
import { verifyArtifactOrigin } from './ci-build-origin.mjs';
const API = 'https://api.github.com';
const MAX_ARCHIVE = 256 * 1024 * 1024;
export async function findTrustedBuild({ repository, repositoryId, key, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(repositoryId)
    || !/^[a-f0-9]{64}$/.test(key) || !token) throw Error('BUILD_REUSE_CLIENT_INPUT');
  const base = `${API}/repos/${repository}`;
  const json = async path => {
    const response = await fetchImpl(`${base}${path}`, { redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('BUILD_REUSE_API_UNAVAILABLE');
    return response.json();
  };
  const workflow = await json('/actions/workflows/ci.yml');
  if (!Number.isSafeInteger(workflow.id) || workflow.path !== '.github/workflows/ci.yml') throw Error('BUILD_REUSE_WORKFLOW');
  // Bounded search; an older hit is optional, never a reason to trust less metadata.
  const runs = await json(`/actions/workflows/${workflow.id}/runs?branch=main&status=success&per_page=10`);
  if (!Array.isArray(runs.workflow_runs)) throw Error('BUILD_REUSE_RUNS');
  for (const candidate of runs.workflow_runs) {
    if (!Number.isSafeInteger(candidate.id)) continue;
    // Re-read exact current run instead of trusting list filters alone.
    const run = await json(`/actions/runs/${candidate.id}`);
    if (!['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success'
      || run.repository?.id !== repositoryId || run.head_repository?.id !== repositoryId || run.workflow_id !== workflow.id) continue;
    const name = `build-reuse-v1-${key}-attempt-${run.run_attempt}`;
    const list = await json(`/actions/runs/${run.id}/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
    if (!Array.isArray(list.artifacts) || list.total_count !== 1 || list.artifacts.length !== 1) continue;
    const artifact = list.artifacts[0];
    if (!Number.isSafeInteger(artifact.id) || artifact.expired !== false || artifact.size_in_bytes > MAX_ARCHIVE) continue;
    // Construct API URL from numeric ID: never send a token to artifact-provided URLs.
    const redirect = await fetchImpl(`${base}/actions/artifacts/${artifact.id}/zip`, { redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (redirect.status !== 302) throw Error('BUILD_REUSE_DOWNLOAD_REDIRECT');
    const url = new URL(redirect.headers.get('location'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(/\.blob\.core\.windows\.net$/.test(url.hostname) || /\.actions\.githubusercontent\.com$/.test(url.hostname))) throw Error('BUILD_REUSE_DOWNLOAD_HOST');
    // No Authorization header on signed storage URL; reject further redirects.
    const response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error('BUILD_REUSE_DOWNLOAD');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_ARCHIVE) throw Error('BUILD_REUSE_ARCHIVE_TOO_LARGE');
      chunks.push(chunk);
    }
    const archive = Buffer.concat(chunks);
    const origin = verifyArtifactOrigin({ apiRun: run, apiArtifact: artifact, archive, expected: {
      repository, repositoryId, workflowId: workflow.id, workflowPath: workflow.path, artifactName: name,
      sourceSha: run.head_sha, runId: run.id, attempt: run.run_attempt, artifactId: artifact.id,
    } });
    return { archive, origin };
  }
  return null;
}
