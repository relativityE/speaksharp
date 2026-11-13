// Read-only GitHub provenance client. An archive never supplies its own authority: the run and the artifact
// are re-read from the authenticated API, and the archive bytes must hash to the API's recorded digest.
import { verifyArtifactOrigin } from './ci-build-origin.mjs';
const API = 'https://api.github.com';

function client({ repository, repositoryId, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !Number.isSafeInteger(repositoryId) || !token) throw Error('BUILD_REUSE_CLIENT_INPUT');
  const base = `${API}/repos/${repository}`;
  const json = async (path) => {
    const response = await fetchImpl(`${base}${path}`, { redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error('BUILD_REUSE_API_UNAVAILABLE');
    return response.json();
  };
  return { base, json, repository, repositoryId, token, fetchImpl };
}

/** The most recent successful main CI runs, each re-read individually rather than trusted from the list. */
export async function* trustedMainRuns(options, { limit = 10 } = {}) {
  const api = client(options);
  const workflow = await api.json('/actions/workflows/ci.yml');
  if (!Number.isSafeInteger(workflow.id) || workflow.path !== '.github/workflows/ci.yml') throw Error('BUILD_REUSE_WORKFLOW');
  const runs = await api.json(`/actions/workflows/${workflow.id}/runs?branch=main&status=success&per_page=${limit}`);
  if (!Array.isArray(runs.workflow_runs)) throw Error('BUILD_REUSE_RUNS');
  for (const candidate of runs.workflow_runs.slice(0, limit)) {
    if (!Number.isSafeInteger(candidate.id)) continue;
    const run = await api.json(`/actions/runs/${candidate.id}`);
    if (!['push', 'workflow_dispatch'].includes(run.event) || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success'
      || run.repository?.id !== options.repositoryId || run.head_repository?.id !== options.repositoryId || run.workflow_id !== workflow.id) continue;
    yield { run, workflow };
  }
}

/** One named artifact of one trusted run, downloaded and bound to that run, or null when it is absent. */
export async function downloadTrustedArtifact(options, { run, workflow, name, maxBytes }) {
  const api = client(options);
  const list = await api.json(`/actions/runs/${run.id}/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
  if (!Array.isArray(list.artifacts) || list.total_count !== 1 || list.artifacts.length !== 1) return null;
  const artifact = list.artifacts[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.expired !== false || !(artifact.size_in_bytes <= maxBytes)) return null;
  // Construct the API URL from the numeric ID: never send a token to an artifact-provided URL.
  const redirect = await api.fetchImpl(`${api.base}/actions/artifacts/${artifact.id}/zip`, { redirect: 'manual',
    headers: { Authorization: `Bearer ${api.token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (redirect.status !== 302) throw Error('BUILD_REUSE_DOWNLOAD_REDIRECT');
  const url = new URL(redirect.headers.get('location'));
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !(/\.blob\.core\.windows\.net$/.test(url.hostname) || /\.actions\.githubusercontent\.com$/.test(url.hostname))) throw Error('BUILD_REUSE_DOWNLOAD_HOST');
  // No Authorization header on the signed storage URL; reject further redirects.
  const response = await api.fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error('BUILD_REUSE_DOWNLOAD');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw Error('BUILD_REUSE_ARCHIVE_TOO_LARGE');
    chunks.push(chunk);
  }
  const archive = Buffer.concat(chunks);
  const origin = verifyArtifactOrigin({ apiRun: run, apiArtifact: artifact, archive, expected: {
    repository: api.repository, repositoryId: api.repositoryId, workflowId: workflow.id, workflowPath: workflow.path, artifactName: name,
    sourceSha: run.head_sha, runId: run.id, attempt: run.run_attempt, artifactId: artifact.id,
  } });
  return { archive, origin };
}
