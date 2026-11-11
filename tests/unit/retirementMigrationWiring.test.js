import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  EXACT_MIGRATION_ALLOWLIST, assertBeforeApply, assertAfterApply, assertExactDryRun,
  assertTerminalOutcome, expectedAuthorizationPhrase, resolveExactMigrationConfig,
  ledgerAwareConfig, prepareExactMigrationWorkspace, verifyMigrationSourceIdentity,
} from '../../scripts/lib/exactMigrationGate.mjs';

const root = resolve(import.meta.dirname, '../..');
const version = '20261110173548';
const file = `${version}_account_coaching_local_retirement.sql`;
const billingVersion = '20261027192550';
const billingFile = `${billingVersion}_account_completion_billing_settlement.sql`;
const config = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: version });
const workflow = readFileSync(resolve(root, '.github/workflows/apply-exact-allowlisted-migration.yml'), 'utf8');
const step = name => {
  const start = workflow.indexOf(`      - name: ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = workflow.indexOf('\n      - ', start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};
const ledger = () => [
  '20260812002000 | 20260812002000 |',
  ...EXACT_MIGRATION_ALLOWLIST.map(entry => `${entry.version} | ${entry.version === version ? '' : entry.version} |`),
  `${billingVersion} | |`,
].join('\n');

describe('exact local retirement apply wiring', () => {
  it('pins exact bytes and orders retirement after both C1 prerequisites', () => {
    expect(config.targetFile).toBe(file);
    expect(config.targetSha256).toBe(createHash('sha256').update(readFileSync(resolve(root, 'backend/supabase/migrations', file))).digest('hex'));
    expect(config.requiredAppliedVersions).toContain('20261025021046');
    expect(config.excludedMigrations.map(row => row.version)).toEqual(['20260812042000', billingVersion]);
    expect(expectedAuthorizationPhrase('a'.repeat(40), config)).toBe(`APPLY ${version} ${file} SHA256 ${config.targetSha256} AT ${'a'.repeat(40)}`);
    expect(assertBeforeApply(ledger(), config).pending).toEqual([version, billingVersion]);
    expect(() => assertBeforeApply(ledger().replace('20261025021046 | 20261025021046', '20261025021046 | '), config)).toThrow();
    expect(() => assertExactDryRun(`Would push these migrations:\n${file}\n20261026090000_unreviewed.sql`, config)).toThrow(/target-only/);
  });

  it('isolates the exact pinned pending billing successor without enabling its application', () => {
    expect(() => resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: billingVersion })).toThrow(/not in/);
    expect(EXACT_MIGRATION_ALLOWLIST.some(row => row.version === billingVersion)).toBe(false);
    expect(() => assertBeforeApply(ledger().replace(`${billingVersion} | |`, `${billingVersion} | ${billingVersion} |`), config)).toThrow(/must remain pending/);
    expect(() => assertBeforeApply(ledger().replace(`${billingVersion} | |`, ''), config)).toThrow(/absent/);
    const source = resolve(root, 'backend/supabase');
    expect(verifyMigrationSourceIdentity(source, config).excludedVersions).toContain(billingVersion);
    const pin = config.excludedMigrations.find(row => row.version === billingVersion);
    expect(pin.sha256).toBe(createHash('sha256').update(readFileSync(resolve(source, 'migrations', billingFile))).digest('hex'));
    const changedPin = { ...config, excludedMigrations: config.excludedMigrations.map(row =>
      row.version === billingVersion ? { ...row, sha256: '0'.repeat(64) } : row) };
    expect(() => verifyMigrationSourceIdentity(source, changedPin)).toThrow(/hash differs/);
    const temp = mkdtempSync(resolve(tmpdir(), 'retirement-exact-'));
    try {
      const workspace = prepareExactMigrationWorkspace(source, temp, ledgerAwareConfig(ledger(), config));
      expect(existsSync(resolve(workspace.supabaseDir, 'migrations', billingFile))).toBe(false);
      expect(existsSync(resolve(workspace.supabaseDir, 'migrations', file))).toBe(true);
      expect(existsSync(resolve(workspace.heldDir, billingFile))).toBe(true);
    } finally { rmSync(temp, { recursive: true, force: true }); }
    const after = ledger().replace(`${version} |  |`, `${version} | ${version} |`);
    expect(assertAfterApply(ledger(), after, config).pending).toEqual([billingVersion]);
    expect(() => assertAfterApply(ledger(), after.replace(`${billingVersion} | |`, `${billingVersion} | ${billingVersion} |`), config)).toThrow(/history delta/);
    const oldTarget = resolveExactMigrationConfig({ SELECTED_TARGET_VERSION: '20261025021046' });
    expect(oldTarget.excludedMigrations.some(row => row.version === billingVersion)).toBe(false);
  });

  it('fails closed for missing, skipped or failed target postflight', () => {
    const outcome = { apply: 'success', verify: 'success', lint: 'success', targetFile: file };
    for (const value of ['', 'skipped', 'failure', 'cancelled']) {
      expect(() => assertTerminalOutcome({ ...outcome, postflights: { [`postflight_${version}`]: value } })).toThrow(/must be success/);
    }
    expect(assertTerminalOutcome({ ...outcome, postflights: { [`postflight_${version}`]: 'success' } }).enforcedPostflights).toEqual([`postflight_${version}`]);
  });

  it('requires credentials and verified TLS before the before/apply/after sequence', () => {
    expect(workflow).toContain(`- '${version}'`);
    const credentials = step('Require existing C1 database password before linked CLI setup');
    expect(credentials).toContain(`inputs.target_version == '${version}'`);
    expect(credentials).toContain('[ -n "${SUPABASE_DB_PASSWORD:-}" ]');
    const tls = step('Prove verification path reachable and TLS-encrypted BEFORE the irreversible apply');
    expect(tls).toContain(`steps.contract.outputs.target_version == '${version}'`);
    expect(tls).toContain('bash scripts/assert-db-connectivity-tls.sh');
    const before = step('Verify local retirement predecessor catalog before exact apply');
    const after = step('Verify local retirement catalog and unchanged activation');
    for (const block of [before, after]) {
      expect(block).toContain('[ -f "$RUNNER_TEMP/pooler.env" ]');
      expect(block).toContain('set -a; . "$RUNNER_TEMP/pooler.env"; set +a');
      expect(block).toContain('unset DB_URL');
      expect(block).not.toContain('supabase-pooler-connection.sh');
    }
    expect(before).toContain(`retirement-migration-postflight.mjs before '${version}' "$RUNNER_TEMP/retirement-before.json"`);
    expect(after).toContain(`retirement-migration-postflight.mjs after '${version}' "$RUNNER_TEMP/retirement-before.json"`);
    expect(after).toContain("always() && steps.apply.outcome == 'success'");
    expect(workflow.indexOf(before)).toBeLessThan(workflow.indexOf('      - name: Apply the exact reviewed migration'));
    expect(workflow.indexOf(tls)).toBeLessThan(workflow.indexOf(before));
    expect(step('Require unambiguous exact-operation success')).toContain(`"postflight_${version}=\${{ steps.postflight_${version}.outcome }}"`);
  });
});
