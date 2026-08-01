#!/usr/bin/env node
// #1097 PR-A — deterministic replay normalizer for the SECURITY DEFINER classification harness.
//
// The classification applies every committed migration to a DISPOSABLE Postgres so it can introspect the
// effective privilege state of SECURITY DEFINER functions. Function definitions and GRANT/REVOKE/table DDL
// are replayed VERBATIM. However, the committed history is not cleanly replayable on a fresh DB because of a
// KNOWN, ENUMERATED historical RLS-policy DDL defect. This module normalizes ONLY that allowlisted
// RLS-policy DDL — nothing else — so the disposable classification database can be constructed.
//
// Guarantees (proven by tests/db/secdef-normalize.contract.test.js):
//  - Only files in NORMALIZE_ALLOWLIST are transformed at all; every other migration is byte-identical.
//  - For an allowlisted file, ONLY CREATE/DROP POLICY statements change; no CREATE/OR REPLACE FUNCTION,
//    GRANT, REVOKE, CREATE/ALTER TABLE, or ALTER FUNCTION statement is added, removed, or altered.
//  - The guard is injected INLINE so a statement commented out on its own line (some migrations put SQL
//    after a same-line `--`) stays a no-op.
//
// Anything NOT on the allowlist is returned unchanged; if such a migration then fails verbatim replay, the
// workflow (psql -v ON_ERROR_STOP=1 under set -euo pipefail) FAILS CLOSED — an unallowlisted replay defect
// is surfaced, never silently normalized.

// EXACT allowlist: filename → the historical RLS-policy defect it carries.
// 20250825065500_fix_rls_performance_issue.sql: DROPs four policies initial_schema never created AND
//   re-creates "Users can manage own sessions" (already created by initial_schema) → not verbatim-replayable.
export const NORMALIZE_ALLOWLIST = new Map([
  ['20250825065500_fix_rls_performance_issue.sql',
   'drops four never-created policies + recreates "Users can manage own sessions"'],
]);

/**
 * Normalize ONLY allowlisted RLS-policy DDL for disposable-DB replay. Returns the SQL unchanged for any
 * file not on the allowlist. For an allowlisted file: `DROP POLICY` → `DROP POLICY IF EXISTS`, and each
 * `CREATE POLICY "x" ON t` is preceded, inline, by `DROP POLICY IF EXISTS "x" ON t; `.
 */
export function normalizeForReplay(sql, basename) {
  if (!NORMALIZE_ALLOWLIST.has(basename)) return sql;
  return sql
    .replace(/DROP[ \t]+POLICY[ \t]+(?:IF[ \t]+EXISTS[ \t]+)?/gi, 'DROP POLICY IF EXISTS ')
    .replace(/(CREATE\s+POLICY\s+("[^"]+"|\S+)\s+ON\s+(\S+))/gi, 'DROP POLICY IF EXISTS $2 ON $3; $1');
}

// CLI: `node scripts/secdef-normalize-migration.mjs <path>` prints the normalized SQL to stdout.
import { fileURLToPath } from 'node:url';
import { realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const file = process.argv[2];
  if (!file) { process.stderr.write('usage: secdef-normalize-migration.mjs <migration.sql>\n'); process.exit(2); }
  process.stdout.write(normalizeForReplay(readFileSync(file, 'utf8'), path.basename(file)));
}
