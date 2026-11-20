// Exact, content-free catalog attestation. No cleanup RPC or application row is read.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';

export const SAVE_JOURNAL_CLEANUP_VERSION = '20261119200000';
const predecessor = Object.freeze([
  '20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653',
  '20261024083000', '20261025021046', '20261110173548', '20261112133000', '20261114100000',
  '20261114170000', '20261117105700', '20261119120000',
]);
const held = ['20261027192550', '20261112130000'];
const table = 'account_save_journal_cleanup_claims';
const functions = [
  ['claim_account_save_journal_cleanup_v1', 'p_user_id uuid, p_run_binding jsonb, p_token text', 'void', 'plpgsql', 'v'],
  ['count_account_save_journal_v1', 'p_user_id uuid', 'integer', 'sql', 's'],
  ['delete_deleted_account_save_journal_v1', 'p_user_id uuid, p_token text', 'integer', 'plpgsql', 'v'],
  ['list_unfinished_account_save_journal_cleanup_runs_v1', 'p_min_age_seconds integer', 'jsonb', 'plpgsql', 'v'],
  ['resume_account_save_journal_cleanup_v1', 'p_user_id uuid, p_email text, p_run_binding jsonb, p_token text', 'void', 'plpgsql', 'v'],
  ['resume_run_account_save_journal_cleanups_v1', 'p_run_binding jsonb, p_token text', 'jsonb', 'plpgsql', 'v'],
];
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw new Error(`save journal cleanup ${reason}`); };

export function saveJournalCleanupContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== SAVE_JOURNAL_CLEANUP_VERSION) fail('phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin || pin.classification !== 'staged') fail('target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) fail('source alias');
  const source = readFileSync(path, 'utf8');
  if (hash('sha256', source) !== pin.sha256) fail('source mismatch');
  const declarations = [...source.matchAll(/^CREATE FUNCTION public\.(\w+)\(([^\n]*)\)\nRETURNS (\w+) LANGUAGE (\w+)( STABLE)? SECURITY DEFINER SET search_path='' AS \$\$([\s\S]*?)\$\$;/gm)];
  if (declarations.length !== functions.length) fail('source function shape mismatch');
  const expectedFunctions = functions.map(([name, args, result, language, volatility]) => {
    const found = declarations.filter(([, n, a, r, l, stable]) =>
      n === name && a === args && r === result && l === language && (stable ? 's' : 'v') === volatility);
    if (found.length !== 1) fail('source function shape mismatch');
    return [name, args, result, language, volatility, hash('md5', found[0][6]), true, ['search_path=""'],
      'postgres', 'f', false, false, 'u', ['postgres:postgres:false', 'service_role:postgres:false'],
      [false, false, true]];
  });
  return { mode, version, targetSha256: pin.sha256, expectedFunctions };
}

export function saveJournalCleanupSnapshotQuery() {
  // Array rows keep key order stable across PostgreSQL and PGlite. The major version
  // controls how NOT NULL is represented, rather than pinning PG18-generated names.
  const names = functions.map(([name]) => `'${name}'`).join(',');
  const roles = "ARRAY['anon','authenticated','service_role']";
  return `WITH target AS (SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='${table}')
  SELECT json_build_object(
    'major', current_setting('server_version_num')::integer / 10000,
    'ledger', (SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)
      FROM supabase_migrations.schema_migrations WHERE version >= '${predecessor[0]}'),
    'functions', (SELECT COALESCE(json_agg(json_build_array(p.proname,pg_get_function_identity_arguments(p.oid),
      pg_get_function_result(p.oid),l.lanname,p.provolatile,md5(p.prosrc),p.prosecdef,p.proconfig,
      pg_get_userbyid(p.proowner),p.prokind,p.proisstrict,p.proleakproof,p.proparallel,
      (SELECT COALESCE(json_agg(pg_get_userbyid(a.grantee)||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable::text
        ORDER BY pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.is_grantable),'[]'::json)
       FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'),
      ARRAY(SELECT has_function_privilege(r,p.oid,'EXECUTE') FROM unnest(${roles}) AS x(r)))
      ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname IN (${names})),
    'table', (SELECT json_build_object(
      'shape',json_build_array(t.relkind,pg_get_userbyid(t.relowner),t.relrowsecurity,t.relforcerowsecurity,t.relpersistence,t.relispartition),
      'acl',(SELECT COALESCE(json_agg(pg_get_userbyid(a.grantee)||':'||pg_get_userbyid(a.grantor)||':'||a.privilege_type||':'||a.is_grantable::text
        ORDER BY a.privilege_type,pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.is_grantable),'[]'::json)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) a),
      'effectiveAccess', ARRAY(SELECT has_table_privilege(r,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(r,t.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        FROM unnest(${roles}) AS x(r)),
      'columns',(SELECT COALESCE(json_agg(json_build_array(a.attname,format_type(a.atttypid,a.atttypmod),
        a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attacl,a.attidentity,a.attgenerated) ORDER BY a.attnum),'[]'::json)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT COALESCE(json_agg(json_build_array(c.conname,c.contype,c.conkey,c.convalidated,
        c.condeferrable,c.condeferred,c.connoinherit,pg_get_constraintdef(c.oid,false)) ORDER BY c.conname),'[]'::json)
        FROM pg_constraint c WHERE c.conrelid=t.oid AND c.contype<>'n'),
      'notNullConstraints',(SELECT COALESCE(json_agg(json_build_array(c.conkey,c.convalidated,c.connoinherit)
        ORDER BY c.conkey),'[]'::json) FROM pg_constraint c WHERE c.conrelid=t.oid AND c.contype='n'),
      'indexes',(SELECT COALESCE(json_agg(json_build_array(i.indisprimary,i.indisunique,i.indisvalid,i.indisready,
        i.indnkeyatts,i.indnatts,i.indkey::text,i.indpred IS NULL,i.indexprs IS NULL)),'[]'::json)
        FROM pg_index i WHERE i.indrelid=t.oid),
      'extra',json_build_array(
        (SELECT count(*) FROM pg_policy WHERE polrelid=t.oid),
        (SELECT count(*) FROM pg_trigger WHERE tgrelid=t.oid),
        (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid=t.oid),
        (SELECT count(*) FROM pg_inherits WHERE t.oid IN (inhrelid,inhparent)),
        (SELECT count(*) FROM pg_rewrite WHERE ev_class=t.oid))) FROM target t))::text;`;
}

const columns = [
  ['user_id', 'uuid', true, null], ['run_binding', 'jsonb', false, null], ['token_sha256', 'bytea', true, null],
  ['email_sha256', 'bytea', true, null], ['claimed_at', 'timestamp with time zone', true, 'clock_timestamp()'],
].map(column => [...column, null, '', '']);
const constraints = [
  [`${table}_email_sha256_check`, 'c', [4], true, false, false, false, 'CHECK ((octet_length(email_sha256) = 32))'],
  [`${table}_pkey`, 'p', [1], true, false, false, true, 'PRIMARY KEY (user_id)'],
  [`${table}_run_binding_check`, 'c', [2], true, false, false, false, "CHECK (((run_binding IS NULL) OR (jsonb_typeof(run_binding) = 'object'::text)))"],
  [`${table}_token_sha256_check`, 'c', [3], true, false, false, false, 'CHECK ((octet_length(token_sha256) = 32))'],
];

export function assertSaveJournalCleanupSnapshot(contract, snapshot) {
  if (!snapshot || ![17, 18].includes(snapshot.major)) fail('unsupported PostgreSQL major');
  if (!Array.isArray(snapshot.ledger) || held.some(v => snapshot.ledger.includes(v))) fail('ledger contains a withheld migration');
  const after = contract.mode === 'after';
  if (!same(snapshot.ledger, after ? [...predecessor, contract.version] : predecessor)) fail('ledger does not match the phase');
  if (!after) {
    if (!same(snapshot.functions, []) || snapshot.table !== null) fail('target objects already present');
    return { mode: 'before', version: contract.version, target: 'absent', postgresMajor: snapshot.major };
  }
  if (!same(snapshot.functions, contract.expectedFunctions)) fail('function catalog differs');
  const t = snapshot.table;
  const ownerAcl = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
    .map(privilege => `postgres:postgres:${privilege}:false`);
  if (!t || !same(t.shape, ['r', 'postgres', true, false, 'p', false]) || !same(t.acl, ownerAcl)
    || !same(t.effectiveAccess, [false, false, false])) fail('claims table owner, RLS or permissions differ');
  if (!same(t.columns, columns)) fail('claims table columns differ');
  if (!same(t.constraints, constraints)) fail('claims table constraints differ');
  const expectedNotNull = snapshot.major === 18 ? [1, 3, 4, 5].map(n => [[n], true, false]) : [];
  if (!same(t.notNullConstraints, expectedNotNull)) fail('claims table not-null constraints differ');
  if (!same(t.indexes, [[true, true, true, true, 1, 1, '1', true, true]])
    || !same(t.extra, [0, 0, 0, 0, 0])) fail('claims table has unexpected objects');
  return { mode: 'after', version: contract.version, target: 'exact', postgresMajor: snapshot.major };
}
