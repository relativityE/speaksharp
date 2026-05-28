import { describe, expect, it } from 'vitest';
import { buildSandboxEpermArtifact, isSandboxBindEperm } from '../../scripts/sandbox-eperm-evidence.mjs';

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
});
