export function isSandboxBindEperm(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('listen EPERM') &&
    (message.includes('127.0.0.1') ||
      message.includes('0.0.0.0') ||
      message.includes('::1'))
  );
}

export function isSandboxProcessControlEperm(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\bEPERM\b/i.test(message) &&
    (/\bkill\b/i.test(message) || /\bspawn\b/i.test(message) || /operation not permitted/i.test(message))
  );
}

export function buildSandboxEpermArtifact({ error, host, port, generatedAt = new Date().toISOString() }) {
  return {
    status: 'invalid',
    reason: 'sandbox_eperm_preview_bind',
    sandboxEperm: true,
    countsAsRcEvidence: false,
    message: 'Local sandbox blocked preview server bind. Re-run in a normal terminal or GitHub Actions for CI-equivalent evidence. This artifact cannot be used to close RC gates.',
    host,
    port,
    error: error instanceof Error ? error.message : String(error),
    generatedAt,
  };
}

export function buildSandboxProcessControlEpermArtifact({
  error,
  command = 'browser process control',
  generatedAt = new Date().toISOString(),
}) {
  return {
    status: 'invalid',
    reason: 'sandbox_eperm_process_control',
    sandboxEperm: true,
    countsAsRcEvidence: false,
    message: 'Local sandbox blocked browser process launch or teardown. Re-run in a normal terminal or GitHub Actions for CI-equivalent evidence. This artifact cannot be used to close RC gates.',
    command,
    error: error instanceof Error ? error.message : String(error),
    generatedAt,
  };
}
