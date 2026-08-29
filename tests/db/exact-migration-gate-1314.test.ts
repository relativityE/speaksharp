// @vitest-environment node
//
// #1314 — negative + positive tests for the exact migration gate, proving the production apply path can apply
// #1314 with the reviewed enforcement intact. Required by the PM RETURN on the four P1 blockers.
import { describe, it, expect } from 'vitest';
import {
  EXACT_MIGRATION_ALLOWLIST,
  validateExactMigrationAllowlist,
  resolveExactMigrationConfig,
  assertBeforeApply,
  assertAfterApply,
  assertTerminalOutcome,
} from '../../scripts/lib/exactMigrationGate.mjs';

const V1314 = '20260819120000';
const ACTIVATION = '20260812042000';

// A synthetic `supabase migration list` renderer: local (checked-in) and remote (applied) columns.
function migrationList(rows: Array<{ v: string; local: boolean; remote: boolean }>): string {
  const head = '   Local          | Remote         | Time (UTC)\n  ----------------|----------------|--------------------';
  const body = rows.map((r) =>
    `   ${r.local ? r.v : '                '} | ${r.remote ? r.v : '                '} | 2026-01-01 00:00:00`).join('\n');
  return `${head}\n${body}`;
}

describe('#1314 exact-migration allowlist', () => {
  it('validates, and #1314 is present as a staged target', () => {
    expect(() => validateExactMigrationAllowlist()).not.toThrow();
    const e = EXACT_MIGRATION_ALLOWLIST.find((x) => x.version === V1314);
    expect(e).toBeDefined();
    expect(e!.classification).toBe('staged');
    expect(e!.file).toBe('20260819120000_complete_session_v2_atomic_retention_1314.sql');
  });

  it('positions #1314 BEFORE commercial activation, so applying it does NOT require activation', () => {
    const cfg = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: V1314 });
    expect(cfg.requiredAppliedVersions).not.toContain(ACTIVATION);   // must NOT require activation first
    expect(cfg.excludedMigrations.map((m) => m.version)).toContain(ACTIVATION); // activation stays pending
    expect(cfg.classification).toBe('staged');
  });

  it('commercial activation is still the final entry (invariant preserved)', () => {
    const last = EXACT_MIGRATION_ALLOWLIST[EXACT_MIGRATION_ALLOWLIST.length - 1];
    expect(last.version).toBe(ACTIVATION);
    expect(last.classification).toBe('commercial-activation');
  });

  it('NEGATIVE: an unavailable target is rejected', () => {
    expect(() => resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '29999999999999' }))
      .toThrow(/not in the checked-in allowlist/);
  });

  it('NEGATIVE: a non-activation-last allowlist is rejected', () => {
    const bad = [...EXACT_MIGRATION_ALLOWLIST.filter((e) => e.version !== ACTIVATION)]; // drops the activation
    expect(() => validateExactMigrationAllowlist(bad)).toThrow(/commercial activation/);
  });

  it('NEGATIVE: a duplicate entry is rejected', () => {
    const dup = [...EXACT_MIGRATION_ALLOWLIST, EXACT_MIGRATION_ALLOWLIST[0]];
    expect(() => validateExactMigrationAllowlist(dup)).toThrow(/duplicate|commercial activation/);
  });
});

describe('#1314 pending-set enforcement (does not require activation, keeps unselected pending)', () => {
  const cfg = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: V1314 });

  /**
   * The excluded set is DERIVED, never hardcoded.
   *
   * It was previously written out as just the activation entry, so adding #1306 Stage B to the allowlist
   * broke these tests even though the enforcement was working correctly — the pending set is
   * position-based, so every entry after the target is legitimately excluded. Deriving it keeps the
   * assertions honest and stops the next allowlist addition from looking like a regression.
   */
  const excludedPending = cfg.excludedMigrations.map((m) => ({ v: m.version, local: true, remote: false }));
  const excludedApplied = cfg.excludedMigrations.map((m) => ({ v: m.version, local: true, remote: true }));

  it('BEFORE apply: exactly {target, excluded} pending, prerequisites applied — passes', () => {
    const rows = [
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })), // prerequisites applied
      { v: V1314, local: true, remote: false },            // target pending
      ...excludedPending,                                   // every later entry stays pending
    ];
    expect(() => assertBeforeApply(migrationList(rows), cfg)).not.toThrow();
  });

  it('NEGATIVE: if activation were already applied, the pending set is wrong — fails', () => {
    const rows = [
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })),
      { v: V1314, local: true, remote: false },
      ...excludedApplied,   // an excluded entry already applied -> not pending -> wrong set
    ];
    expect(() => assertBeforeApply(migrationList(rows), cfg)).toThrow(/pending/);
  });

  it('AFTER apply: target applied, activation still pending — passes', () => {
    const before = migrationList([
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })),
      { v: V1314, local: true, remote: false },
      ...excludedPending,
    ]);
    const after = migrationList([
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })),
      { v: V1314, local: true, remote: true },       // now applied
      ...excludedPending,                             // every excluded entry still pending
    ]);
    expect(() => assertAfterApply(before, after, cfg)).not.toThrow();
  });

  it('NEGATIVE: if activation got applied by the push, after-state fails', () => {
    const before = migrationList([
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })),
      { v: V1314, local: true, remote: false },
      { v: ACTIVATION, local: true, remote: false },
    ]);
    const after = migrationList([
      ...cfg.requiredAppliedVersions.map((v) => ({ v, local: true, remote: true })),
      { v: V1314, local: true, remote: true },
      { v: ACTIVATION, local: true, remote: true },  // activation wrongly applied too
    ]);
    expect(() => assertAfterApply(before, after, cfg)).toThrow();
  });
});

describe('#1314 terminal authority includes the postflight outcome', () => {
  it('a failed postflight fails the terminal gate', () => {
    expect(() => assertTerminalOutcome('success', 'success', 'success', 'failure'))
      .toThrow(/postflight/);
  });
  it('a cancelled postflight fails the terminal gate', () => {
    expect(() => assertTerminalOutcome('success', 'success', 'success', 'cancelled'))
      .toThrow(/postflight/);
  });
  it('a successful postflight passes', () => {
    expect(assertTerminalOutcome('success', 'success', 'success', 'success')).toEqual({ terminal: 'success' });
  });
  it("a skipped postflight (non-#1314 migration) is allowed", () => {
    expect(assertTerminalOutcome('success', 'success', 'success', 'skipped')).toEqual({ terminal: 'success' });
  });
  it('still fails when apply/verify/lint fail regardless of postflight', () => {
    expect(() => assertTerminalOutcome('failure', 'success', 'success', 'success')).toThrow(/apply/);
  });
});
