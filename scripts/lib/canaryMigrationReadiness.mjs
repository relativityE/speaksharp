import { parseMigrationList } from './exactMigrationGate.mjs';

export const CANARY_RUNTIME_MIGRATION = '20260812041500';

export function evaluateCanaryMigrationReadiness(output, version = CANARY_RUNTIME_MIGRATION) {
  const rows = parseMigrationList(output);
  const matches = rows.filter((row) => row.local === version || row.remote === version);
  if (matches.length !== 1) throw new Error(`expected exactly one migration-history row for ${version}`);
  const row = matches[0];
  if (row.local !== version) throw new Error(`migration ${version} is missing from checked-in source`);
  if (row.remote === version) return { ready: true, version, state: 'applied' };
  if (row.remote === null) return { ready: false, version, state: 'pending' };
  throw new Error(`migration ${version} has mismatched local/remote history`);
}
