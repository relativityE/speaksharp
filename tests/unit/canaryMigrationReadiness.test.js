import { describe, expect, it } from 'vitest';
import {
  evaluateCanaryMigrationReadiness,
  REQUIRED_APPLIED_MIGRATIONS,
  HELD_ACTIVATION_MIGRATION,
} from '../../scripts/lib/canaryMigrationReadiness.mjs';
import { EXACT_MIGRATION_ALLOWLIST } from '../../scripts/lib/exactMigrationGate.mjs';

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
  it('requires the ordered staged prerequisites through 41600 and holds 42000', () => {
    // The required set is DERIVED: every allowlist entry classified `staged`, behind the already-applied
    // webhook prerequisite. It was previously asserted as a hardcoded literal, which made the coupling
    // invisible — adding a staged allowlist entry silently enlarges what the canary demands of production,
    // and a HOLD skips the product lanes while the run still reports success. Assert the DERIVATION, so a
    // new entry shows up here as an intentional change rather than a literal to be quietly edited.
    expect(REQUIRED_APPLIED_MIGRATIONS).toEqual([
      '20260812002000',
      ...EXACT_MIGRATION_ALLOWLIST.filter((m) => m.classification === 'staged').map((m) => m.version),
    ]);
    // The staged set still leads with the pre-activation ordering, and #1306 Stage B now joins it.
    expect(REQUIRED_APPLIED_MIGRATIONS).toContain('20260819120000');
    expect(REQUIRED_APPLIED_MIGRATIONS).toContain('20260829120000');
    // Activation is NOT in the required set — it is held, and holding it is the point.
    expect(REQUIRED_APPLIED_MIGRATIONS).not.toContain('20260812042000');
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

  it('CASUALTY: 42000 recorded applied is the EXPECTED state and must not fail the canary closed', () => {
    // The production state since 2026-09-12. 42000 sorts before the remote head, so it blocked every
    // ordinary `db push` as out-of-order; it was recorded applied WITHOUT executing (deploy 34691493637 —
    // the dry-run listed only the three release migrations) so the retention migration could land. The old
    // rule read "applied" as "the commercial activation ran" and failed closed forever on a state the
    // history cannot disambiguate. Reproduced against the real production list before this change:
    //   {"ready":false,"state":"activation-applied","heldActivation":"20260812042000"}
    const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'applied' }));
    expect({ ready: r.ready, state: r.state, recorded: r.activationRecorded })
      .toEqual({ ready: true, state: 'applied', recorded: true });
  });

  it('CONTROL: the recorded fact is reported, not a claim about what ran', () => {
    // The field says "42000 is recorded applied". It deliberately does NOT say the activation executed —
    // the migration history cannot tell those apart, and #1282 records that it did not.
    const applied = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'applied' }));
    const notApplied = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: 'pending' }));
    expect({ applied: applied.activationRecorded, notApplied: notApplied.activationRecorded })
      .toEqual({ applied: true, notApplied: false });
  });

  it('READY whether 42000 is recorded applied or still pending — neither blocks the product lanes', () => {
    for (const state of ['applied', 'pending']) {
      const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), [HELD_ACTIVATION_MIGRATION]: state }));
      expect({ state, ready: r.ready }).toEqual({ state, ready: true });
    }
  });

  it('CONTROL: a genuinely pending REQUIRED migration still holds the canary', () => {
    // Loosening the activation rule must not loosen the thing the canary is actually for.
    const r = evaluateCanaryMigrationReadiness(listing({ ...allAppliedStates(), '20260812040000': 'pending' }));
    expect({ ready: r.ready, state: r.state }).toEqual({ ready: false, state: 'pending' });
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
