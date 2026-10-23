// SELECT-only exact T2 pre/postflight. Does not apply or repair migration history.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { EXACT_MIGRATION_ALLOWLIST } from './lib/exactMigrationGate.mjs';
import { T2_VERSIONS, T2_INVENTORY, assertT2Sources, t2CatalogQuery,
  t2ExpectedCatalog, assertT2Catalog, t2DisabledQuery, assertT2Disabled, t2LedgerQuery, t2AdmissionQuery } from './lib/t2MigrationPostflight.mjs';

try {
  const [mode, version] = process.argv.slice(2);
  const expected = t2ExpectedCatalog(mode, version);
  const sources = Object.fromEntries(T2_VERSIONS.map(target => {
    const entry = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === target);
    return [target, readFileSync(new URL(`../backend/supabase/migrations/${entry.file}`, import.meta.url), 'utf8')];
  }));
  assertT2Sources(sources);
  const completionPresent = version === 'release' || (version === T2_VERSIONS.at(-1) && mode === 'after');
  const admissionEnforced = version === 'release' || T2_VERSIONS.indexOf(version) > 3
    || (T2_VERSIONS.indexOf(version) === 3 && mode === 'after');
  const args = process.env.DB_URL ? [process.env.DB_URL] : [];
  const result = execFileSync('psql', [...args, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
    `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,pg_temp;\n${t2CatalogQuery(T2_INVENTORY)}\n${t2DisabledQuery(completionPresent)}\n${t2LedgerQuery(mode, version)}\n${t2AdmissionQuery(admissionEnforced)}\nCOMMIT;`], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ''} -c default_transaction_read_only=on` },
  }).trim().split('\n');
  if (result.length !== 4) throw new Error('incomplete T2 catalog evidence');
  const catalog = assertT2Catalog(result[0], expected);
  const disabled = assertT2Disabled(result[1], completionPresent);
  if (result[2] !== 'true') throw new Error('T2 migration ledger prerequisite failed');
  if (result[3] !== 'true') throw new Error('T2 recording admission prerequisite failed');
  console.log(JSON.stringify({ mode, version, catalog, disabled, passed: true }));
} catch (error) {
  // Errors name only catalog objects, never database output or connection data.
  const reason = error instanceof Error && /^(T2 |invalid T2|incomplete T2)/.test(error.message)
    ? error.message : 'T2 catalog verification could not execute';
  console.error(reason + '; application/release remains held');
  process.exitCode = 1;
}
