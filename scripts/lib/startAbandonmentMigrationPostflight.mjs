// Exact catalog-only gate for the #1831 start-abandonment migration (20261112133000). SELECT-only: it never
// invokes a business RPC, reads account data or writes. "before" proves the installed predecessor shape and that
// nothing of the target exists yet; "after" proves the exact target catalog and that nothing else moved.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';
import { functionDefinitions } from './c1MigrationPostflight.mjs';

export const START_ABANDONMENT_VERSION = '20261112133000';
const PREDECESSOR = Object.freeze({ version: '20261020230653', file: '20261020230653_account_pending_completion_journal_1643.sql' });
// Applied before this target and pending after it (PO holds); both must keep the same state across the apply.
const REQUIRED_APPLIED = Object.freeze(['20261110173548']);
const MUST_REMAIN_PENDING = Object.freeze(['20261027192550', '20261112130000']);
const OBLIGATION_FUNCTIONS = Object.freeze(['public._account_save_lease_obligation_v1()', 'public._account_save_session_obligation_v1()']);
const NEW_FUNCTION = 'public.abandon_recording_start_v1(uuid)';
const NEW_TABLE = 'recording_start_abandonments';
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

function readPinned(root, file, sha256) {
  const path = join(root, 'backend/supabase/migrations', file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error(`start abandonment source alias: ${file}`);
  const source = readFileSync(path, 'utf8');
  if (sha256 && createHash('sha256').update(source).digest('hex') !== sha256) throw new Error(`start abandonment source mismatch: ${file}`);
  return source;
}

function byName(definitions, signature) {
  const found = definitions.filter(fn => fn.signature === signature);
  if (found.length !== 1) throw new Error(`start abandonment source shape unavailable: ${signature}`);
  return found[0];
}

export function startAbandonmentContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== START_ABANDONMENT_VERSION) throw new Error('start abandonment phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin) throw new Error('start abandonment target is not allowlisted');
  const target = functionDefinitions(readPinned(root, pin.file, pin.sha256));
  const predecessor = functionDefinitions(readPinned(root, PREDECESSOR.file, null));
  if (target.length !== 3) throw new Error('start abandonment function source shape unavailable');
  const source = mode === 'after' ? target : predecessor;
  return {
    mode, version, targetSha256: pin.sha256,
    obligations: OBLIGATION_FUNCTIONS.map(signature => ({ signature, expected: byName(source, signature) })),
    abandon: mode === 'after' ? byName(target, NEW_FUNCTION) : null,
  };
}

/** Five rows, each one JSON value: ledger, obligation functions, abandonment function, table, trigger bindings. */
export function startAbandonmentSnapshotQuery() {
  const versions = [...REQUIRED_APPLIED, ...MUST_REMAIN_PENDING, START_ABANDONMENT_VERSION].map(literal).join(',');
  const fn = signature => `(SELECT json_build_object('exists',true,'md5',md5(p.prosrc),'definer',p.prosecdef,
      'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile::text,
      'acl',COALESCE((SELECT json_agg(r ORDER BY r) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS r
        FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') g),'[]'::json))
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(signature)}))`;
  return [
    `SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations WHERE version IN (${versions});`,
    `SELECT json_build_array(${OBLIGATION_FUNCTIONS.map(fn).join(',')})::text;`,
    `SELECT COALESCE(${fn(NEW_FUNCTION)},json_build_object('exists',false))::text;`,
    `SELECT COALESCE((SELECT json_build_object('exists',true,'rls',c.relrowsecurity,
        'apiPrivileges',(SELECT COALESCE(json_agg(DISTINCT pg_get_userbyid(a.grantee) ORDER BY pg_get_userbyid(a.grantee)),'[]'::json)
          FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>0 AND pg_get_userbyid(a.grantee) IN (${API_ROLES.map(literal).join(',')})),
        'publicPrivileges',(SELECT count(*) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${literal(NEW_TABLE)}),
      json_build_object('exists',false))::text;`,
    `SELECT COALESCE(json_agg(json_build_object('table',t.tgrelid::regclass::text,'function',p.proname) ORDER BY t.tgrelid::regclass::text,p.proname),'[]'::json)::text
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal
        AND p.proname IN ('_account_save_lease_obligation_v1','_account_save_session_obligation_v1');`,
  ].join('\n');
}

function assertFunction(actual, expected, label) {
  if (!actual || actual.exists !== true) throw new Error(`start abandonment ${label} absent`);
  if (actual.md5 !== expected.bodyMd5 || actual.definer !== expected.securityDefiner || actual.language !== expected.language
    || actual.volatility !== expected.volatility || JSON.stringify(actual.config ?? null) !== JSON.stringify(expected.config)) {
    throw new Error(`start abandonment ${label} shape differs from source`);
  }
}

export function assertStartAbandonmentSnapshot(contract, rows, prior) {
  if (!Array.isArray(rows) || rows.length !== 5) throw new Error('start abandonment snapshot incomplete');
  const [ledger, obligations, abandon, table, triggers] = rows.map(row => JSON.parse(row));
  const applied = new Set(ledger);
  for (const version of REQUIRED_APPLIED) if (!applied.has(version)) throw new Error(`start abandonment prerequisite not applied: ${version}`);
  for (const version of MUST_REMAIN_PENDING) if (applied.has(version)) throw new Error(`start abandonment withheld migration applied: ${version}`);
  if (applied.has(contract.version) !== (contract.mode === 'after')) throw new Error('start abandonment ledger does not match the phase');
  contract.obligations.forEach((entry, index) => assertFunction(obligations[index], entry.expected, entry.signature));
  if (contract.mode === 'before') {
    if (abandon.exists !== false || table.exists !== false) throw new Error('start abandonment target objects already present');
  } else {
    assertFunction(abandon, contract.abandon, NEW_FUNCTION);
    // EXECUTE for authenticated only: never PUBLIC, anon or service_role (the owner is not an API role).
    const apiGrants = abandon.acl.filter(role => role === 'PUBLIC' || API_ROLES.includes(role));
    if (JSON.stringify(apiGrants) !== JSON.stringify(['authenticated'])) throw new Error('start abandonment function ACL differs');
    if (table.exists !== true || table.rls !== true || table.apiPrivileges.length !== 0 || table.publicPrivileges !== 0) {
      throw new Error('start abandonment table shape differs');
    }
    if (!prior || prior.version !== contract.version || prior.targetSha256 !== contract.targetSha256 || !Array.isArray(prior.rows)) {
      throw new Error('start abandonment prior receipt missing or mismatched');
    }
    // The apply replaces function bodies only; the trigger bindings must be exactly the predecessor's.
    if (prior.rows[4] !== rows[4]) throw new Error('start abandonment trigger bindings changed');
  }
  if (triggers.length !== 2) throw new Error('start abandonment obligation triggers unavailable');
  return { mode: contract.mode, version: contract.version, obligations: 'exact', target: contract.mode === 'after' ? 'exact' : 'absent' };
}
