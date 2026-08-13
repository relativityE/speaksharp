import { describe, expect, it } from 'vitest';
import { evaluateCanaryMigrationReadiness } from '../../scripts/lib/canaryMigrationReadiness.mjs';

const row = (local, remote) => ` ${local ?? ''} | ${remote ?? ''} | 2026-08-12 04:15:00 `;

describe('canary migration readiness', () => {
  it('returns HOLD/pending until the exact runtime migration is remote-applied', () => {
    expect(evaluateCanaryMigrationReadiness(row('20260812041500', null))).toEqual({
      ready: false,
      version: '20260812041500',
      state: 'pending',
    });
  });

  it('allows product lanes only when local and remote identities match', () => {
    expect(evaluateCanaryMigrationReadiness(row('20260812041500', '20260812041500')).ready).toBe(true);
  });

  it.each([
    ['absent', row('20260812041000', '20260812041000')],
    ['remote only', row(null, '20260812041500')],
    ['mismatch', row('20260812041500', '20260812041000')],
  ])('fails closed for %s history', (_label, output) => {
    expect(() => evaluateCanaryMigrationReadiness(output)).toThrow();
  });
});
