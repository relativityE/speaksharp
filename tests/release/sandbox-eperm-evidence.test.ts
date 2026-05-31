import { describe, expect, it } from 'vitest';
import {
  buildSandboxEpermArtifact,
  buildSandboxProcessControlEpermArtifact,
  isSandboxBindEperm,
  isSandboxProcessControlEperm,
} from '../../scripts/sandbox-eperm-evidence.mjs';

describe('sandbox EPERM evidence classification', () => {
  it('classifies localhost listen EPERM as invalid non-RC evidence', () => {
    const error = new Error('listen EPERM: operation not permitted 127.0.0.1:4173');

    expect(isSandboxBindEperm(error)).toBe(true);
    expect(buildSandboxEpermArtifact({
      error,
      host: '127.0.0.1',
      port: 4173,
      generatedAt: '2026-05-28T00:00:00.000Z',
    })).toMatchObject({
      status: 'invalid',
      reason: 'sandbox_eperm_preview_bind',
      sandboxEperm: true,
      countsAsRcEvidence: false,
      host: '127.0.0.1',
      port: 4173,
      error: 'listen EPERM: operation not permitted 127.0.0.1:4173',
    });
  });

  it('does not classify unrelated bind errors as sandbox EPERM', () => {
    expect(isSandboxBindEperm(new Error('listen EADDRINUSE: address already in use 127.0.0.1:4173'))).toBe(false);
    expect(isSandboxBindEperm(new Error('connect EPERM: operation not permitted'))).toBe(false);
  });

  it('classifies browser process-control EPERM as invalid non-RC evidence', () => {
    const error = new Error('browserType.launch: kill EPERM');

    expect(isSandboxProcessControlEperm(error)).toBe(true);
    expect(buildSandboxProcessControlEpermArtifact({
      error,
      command: 'chromium.launch',
      generatedAt: '2026-05-31T00:00:00.000Z',
    })).toMatchObject({
      status: 'invalid',
      reason: 'sandbox_eperm_process_control',
      sandboxEperm: true,
      countsAsRcEvidence: false,
      command: 'chromium.launch',
      error: 'browserType.launch: kill EPERM',
    });
  });

  it('does not classify unrelated process-control errors as sandbox EPERM', () => {
    expect(isSandboxProcessControlEperm(new Error('browserType.launch: executable not found'))).toBe(false);
  });
});
