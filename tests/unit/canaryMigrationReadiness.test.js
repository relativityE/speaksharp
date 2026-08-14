import { describe, expect, it } from 'vitest';
import {
  evaluateCanaryMigrationReadiness,
  REQUIRED_APPLIED_MIGRATIONS,
  HELD_ACTIVATION_MIGRATION,
} from '../../scripts/lib/canaryMigrationReadiness.mjs';

const row = (local, remote) => ` ${local ?? ''} | ${remote ?? ''} | 2026-08-12 04:15:00 `;

// Build a `supabase migration list`-shaped output from a { version: state } map.
//   applied     → local | remote (both present, applied)
//   pending     → local | (blank) (checked-in, not applied)
//   remote-only → (blank) | remote (a checked-in SOURCE gap)
const listing = (states) =>
  Object.entries(states).map(([version, state]) => {
    if (state === 'applied') return row(version, version);
    if (state === 'pending') return row(version, null);
    if (state === 'remote-only') return row(null, version);
    throw new Error(`bad state ${state}`);
  }).join('\n');

const allAppliedStates = () => Object.fromEntries(REQUIRED_APPLIED_MIGRATIONS.map((v) => [v, 'applied']));

describe('canary migration readiness (full ordered staged set, not just 41500)', () => {
  it('requires the ordered staged prerequisites through 41500 and holds 42000', () => {
    expect(REQUIRED_APPLIED_MIGRATIONS).toEqual([
      '20260812002000', '20260811143000', '20260812030000',
      '20260812039500', '20260812040000', '20260812041000', '20260812041500',
    ]);
    expect(HELD_ACTIVATION_MIGRATION).toBe('20260812042000');
  });

  it('READY only when every required migration is applied and 42000 remains held', () => {
    const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'pending' }));
    expect(r.ready).toBe(true);
    expect(r.state).toBe('applied');
    expect(r.activationHeld).toBe(true);
    expect(r.appliedSet).toEqual(REQUIRED_APPLIED_MIGRATIONS);
  });

  it.each(REQUIRED_APPLIED_MIGRATIONS)('HOLD when required predecessor %s is still pending', (missing) => {
    const states = Object.fromEntries(REQUIRED_APPLIED_MIGRATIONS.map((v) => [v, v === missing ? 'pending' : 'applied']));
    const r = evaluateCanaryMigrationReadiness(listing(states));
    expect(r.ready).toBe(false);
    expect(r.state).toBe('pending');
    expect(r.pending).toContain(missing);
  });

  it('reproduces the exact defect: 41500 applied but predecessors pending → HOLD, not ready', () => {
    const states = Object.fromEntries(
      REQUIRED_APPLIED_MIGRATIONS.map((v) => [v, v === '20260812041500' ? 'applied' : 'pending']),
    );
    const r = evaluateCanaryMigrationReadiness(listing(states));
    expect(r.ready).toBe(false);
    expect(r.pending).toEqual(expect.arrayContaining(['20260812002000', '20260811143000', '20260812040000']));
  });

  it('FAILS CLOSED (not ready) if the held commercial activation migration 42000 is applied', () => {
    const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'applied' }));
    expect(r.ready).toBe(false);
    expect(r.state).toBe('activation-applied');
    expect(r.activationHeld).toBe(false);
  });

  it('READY reports activationHeld=true when 42000 is NOT applied', () => {
    const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'pending' }));
    expect(r.ready).toBe(true);
    expect(r.activationHeld).toBe(true);
  });

  it('fails closed on a checked-in SOURCE gap (a required migration is remote-only)', () => {
    const states = { ...allAppliedStates(), '20260812040000': 'remote-only' };
    expect(() => evaluateCanaryMigrationReadiness(listing(states))).toThrow(/missing from checked-in source/);
  });

  it('fails closed on a mismatched local/remote history row', () => {
    const output = listing(allAppliedStates()) + '\n' + row('20260812041500', '20260812041000');
    expect(() => evaluateCanaryMigrationReadiness(output)).toThrow();
  });
});
