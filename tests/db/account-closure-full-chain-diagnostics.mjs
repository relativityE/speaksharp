import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Original crash reproduction and provider-fixed qualification are explicit,
// immutable targets. Values come from independently retained comparison artifacts.
const imagePins = {
  '17.6.1.106': { digest: '21ab971149317ea9cd12a8126fe4ebb34def08c8972956b0958cba0924409dab',
    imageId: '9ff6402f578a9b0d4f2aa31f660bd398b8e378761d61d31efda6ff9ad92408e5' },
  '17.6.1.155': { digest: '3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b',
    imageId: '56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985' },
};
export function proofPostgresVersion(value = '17.6.1.155') {
  assert.ok(['17.6.1.106', '17.6.1.155'].includes(value), 'unreviewed disposable PostgreSQL version');
  return value;
}
export function proofPostgresImage(version) {
  const selected = proofPostgresVersion(version);
  return { version: selected, tag: `ghcr.io/supabase/postgres:${selected}`,
    repositoryDigest: `ghcr.io/supabase/postgres@sha256:${imagePins[selected].digest}`,
    imageId: `sha256:${imagePins[selected].imageId}` };
}
export function proofImageEvidence(version, container, image) {
  const pin = proofPostgresImage(version);
  assert.equal(container.Config.Image, pin.tag, 'disposable PostgreSQL image differs from selected pin');
  assert.equal(image.Id, container.Image, 'inspected image differs from running container');
  assert.equal(image.Id, pin.imageId, 'running image configuration differs from immutable pin');
  assert.equal(image.Architecture, 'amd64', 'comparison requires the original x86_64 architecture');
  assert.equal(image.Os, 'linux', 'comparison requires Linux');
  assert.ok(image.RepoDigests?.includes(pin.repositoryDigest), 'running repository digest differs from immutable pin');
  return { selectedVersion: version, image: pin.tag, imageId: image.Id, repositoryDigest: pin.repositoryDigest,
    architecture: image.Architecture, os: image.Os, comparisonOnly: version === '17.6.1.106',
    productionRepresentativenessVerified: false };
}

// Disposable diagnostic metadata only. Never retain inspect.Config.Env, SQL
// statements, raw database rows or CLI startup credentials in the artifact.
export function redactProofText(value, limit = 8192) {
  const plain = String(value ?? '').split(String.fromCharCode(27))
    .map((part, index) => index ? part.replace(/^\[[0-?]*[ -/]*[@-~]/, '') : part).join('');
  const text = plain
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[database-url-redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt-redacted]')
    .replace(/((?:password|authorization|apikey|service_role_key|access_token)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email-redacted]');
  if (text.length <= limit) return text;
  const half = Math.floor((limit - 40) / 2);
  return `${text.slice(0, half)}\n[bounded diagnostic: middle omitted]\n${text.slice(-half)}`;
}
export function proofSubprocessFailure(bin, args, result) {
  const stdout = redactProofText(result.stdout);
  const stderr = redactProofText(result.stderr);
  return { command: `${bin} ${args[0] ?? ''}`, status: result.status ?? null, signal: result.signal ?? null,
    errorCode: result.error?.code ?? null, error: result.error ? redactProofText(result.error.message, 1024) : null,
    stdout, stderr, stages: [...new Set(`${stdout}\n${stderr}`.match(/CLOSURE_STAGE [a-z0-9:_-]+/g) ?? [])] };
}
export function captureOwnedDatabaseDiagnostics(containerName, env, execute = spawnSync) {
  if (!/^supabase_db_closure-proof-[a-f0-9]{16}$/.test(containerName)) throw new Error('unowned diagnostic target');
  function command(args) {
    return execute('docker', args, { env, encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024 });
  }
  const format = '{"state":{{json .State}},"image":{{json .Config.Image}},"imageId":{{json .Image}}}';
  const inspect = command(['inspect', '--format', format, containerName]);
  let metadata = null;
  try {
    if (inspect.status !== 0) throw new Error('inspect unavailable');
    const data = JSON.parse(inspect.stdout);
    const allowed = ['Status', 'Running', 'Restarting', 'OOMKilled', 'Dead', 'ExitCode', 'StartedAt', 'FinishedAt'];
    metadata = { image: redactProofText(data.image, 512), imageId: redactProofText(data.imageId, 256),
      state: Object.fromEntries(allowed.filter((key) => Object.hasOwn(data.state ?? {}, key)).map((key) => [key, data.state[key]])),
      stateError: redactProofText(data.state?.Error, 1024) };
  } catch { /* Capture absence explicitly; never hide the primary proof error. */ }
  const logs = command(['logs', '--tail', '160', '--timestamps', containerName]);
  const lines = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`.split('\n')
    .filter((line) => /\b(?:LOG|FATAL|PANIC|ERROR|WARNING):|PostgreSQL.*(?:starting|compiled)/.test(line))
    .filter((line) => !/\b(?:STATEMENT|DETAIL|CONTEXT):|execute <|statement:|query:/i.test(line));
  return { containerName, metadata, inspectStatus: inspect.status ?? null, inspectSignal: inspect.signal ?? null,
    logsStatus: logs.status ?? null, logsSignal: logs.signal ?? null,
    serverDiagnostics: redactProofText(lines.join('\n'), 16384),
    omittedSqlAndPayloadLines: true, capturedBeforeCleanup: true };
}
