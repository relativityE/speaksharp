import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Explicit diagnostic comparison, not an implicit replacement of the original
// qualification environment. Both versions retain their own verdict/artifact.
export function proofPostgresVersion(value = '17.6.1.106') {
  assert.ok(['17.6.1.106', '17.6.1.155'].includes(value), 'unreviewed disposable PostgreSQL version');
  return value;
}
export function proofImageEvidence(version, container, image) {
  const expected = `ghcr.io/supabase/postgres:${proofPostgresVersion(version)}`;
  assert.equal(container.Config.Image, expected, 'disposable PostgreSQL image differs from selected comparison');
  assert.equal(image.Id, container.Image, 'inspected image differs from running container');
  assert.equal(image.Architecture, 'amd64', 'comparison requires the original x86_64 architecture');
  assert.equal(image.Os, 'linux', 'comparison requires Linux');
  const digest = image.RepoDigests?.find((value) => /^ghcr\.io\/supabase\/postgres@sha256:[a-f0-9]{64}$/.test(value));
  assert.ok(digest, 'immutable image repository digest unavailable');
  return { selectedVersion: version, image: expected, imageId: image.Id, repositoryDigest: digest,
    architecture: image.Architecture, os: image.Os, comparisonOnly: true,
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
