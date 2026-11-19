// Exact catalog-only gate for the #1827 outcome 4 D2 migration (20261119120000). SELECT-only: it never invokes an RPC, reads an
// account, session, attempt or tip row, or writes. The migration adds two attempt columns (practised_tip, tip_session_id), one
// check constraint, one partial index, seven private `_prec_att_*` helpers (no API role may execute any of them), two attempt
// triggers and two session triggers. "before" proves the predecessor ledger and that no target object exists; "after" proves the
// whole touched catalog equals the reviewed expectation (repeatTipMigrationCatalog.json), which the offline test re-derives from
// the exact migration bytes on the shipped chain, so it cannot drift from the source.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';

export const REPEAT_TIP_VERSION = '20261119120000';
const REQUIRED_APPLIED = Object.freeze(['20261114170000', '20261117105700']);
const MUST_REMAIN_PENDING = Object.freeze(['20261027192550', '20261112130000']);
export const REPEAT_TIP_FUNCTIONS = Object.freeze(['_prec_att_can_hold_tip', '_prec_att_guard_tip', '_prec_att_lock_owner',
  '_prec_att_on_session_completed', '_prec_att_purge_tip_on_expire', '_prec_att_review_tip', '_prec_att_snapshot_tip']);
export const REPEAT_TIP_TRIGGERS = Object.freeze(['trg_prec_att_guard_tip', 'trg_prec_att_snapshot_tip',
  'trg_sessions_prec_tip_on_completed', 'trg_sessions_purge_practised_tip_on_expire']);
const COLUMNS = Object.freeze(['practised_tip', 'tip_session_id']);
const CONSTRAINT = 'prec_att_practised_tip_shape';
const INDEX = 'idx_prec_att_tip_session';
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const list = values => values.map(literal).join(',');

export function repeatTipContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== REPEAT_TIP_VERSION) throw new Error('repeat tip phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin) throw new Error('repeat tip target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('repeat tip source alias');
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== pin.sha256) throw new Error('repeat tip source mismatch');
  const catalogPath = join(root, 'scripts/lib/repeatTipMigrationCatalog.json');
  if (!lstatSync(catalogPath).isFile() || realpathSync(catalogPath) !== catalogPath) throw new Error('repeat tip expectation alias');
  const expected = JSON.parse(readFileSync(catalogPath, 'utf8'));
  if (expected.version !== version || expected.targetSha256 !== pin.sha256) throw new Error('repeat tip expectation is not for this source');
  return { mode, version, targetSha256: pin.sha256, expected };
}

/** Five rows, each one JSON value: ledger, the seven helpers, the four triggers, the two columns, the constraint and index. */
export function repeatTipSnapshotQuery() {
  const versions = list([...REQUIRED_APPLIED, ...MUST_REMAIN_PENDING, REPEAT_TIP_VERSION]);
  return [
    `SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations WHERE version IN (${versions});`,
    `SELECT COALESCE(json_agg(json_build_object('signature','public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        'md5',md5(p.prosrc),'definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile::text,
        'returns',pg_get_function_result(p.oid),
        'acl',COALESCE((SELECT json_agg(r ORDER BY r) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS r
          FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'
            AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN (${list(API_ROLES)}))) g),'[]'::json))
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)),'[]'::json)::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname IN (${list(REPEAT_TIP_FUNCTIONS)});`,
    `SELECT COALESCE(json_agg(json_build_object('table',rn.nspname||'.'||rc.relname,'name',t.tgname,
        'function','public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','type',t.tgtype,'enabled',t.tgenabled::text,
        'conditional',t.tgqual IS NOT NULL,'columns',cardinality(t.tgattr::int2[]),'definition',pg_get_triggerdef(t.oid,false))
        ORDER BY t.tgname),'[]'::json)::text
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class rc ON rc.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE NOT t.tgisinternal AND rn.nspname='public' AND (t.tgname IN (${list(REPEAT_TIP_TRIGGERS)}) OR p.proname IN (${list(REPEAT_TIP_FUNCTIONS)}));`,
    `SELECT COALESCE(json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid),
        'privileges',COALESCE((SELECT json_agg(pg_get_userbyid(x.grantee)||':'||x.privilege_type ORDER BY pg_get_userbyid(x.grantee),x.privilege_type)
          FROM aclexplode(a.attacl) x WHERE pg_get_userbyid(x.grantee) IN (${list(API_ROLES)})),'[]'::json))
        ORDER BY a.attname),'[]'::json)::text
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.progress_recommendation_attempts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN (${list(COLUMNS)});`,
    `SELECT json_build_object(
        'constraints',COALESCE((SELECT json_agg(k.conname||' '||k.contype::text||' '||pg_get_constraintdef(k.oid) ORDER BY k.conname)
          FROM pg_constraint k WHERE k.conrelid='public.progress_recommendation_attempts'::regclass
            AND (k.conname=${literal(CONSTRAINT)} OR EXISTS (SELECT 1 FROM unnest(k.conkey) c(n) JOIN pg_attribute ka
              ON ka.attrelid=k.conrelid AND ka.attnum=c.n WHERE ka.attname IN (${list(COLUMNS)})))),'[]'::json),
        'indexes',COALESCE((SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid))
          FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
          WHERE i.indrelid='public.progress_recommendation_attempts'::regclass AND ic.relname=${literal(INDEX)}),'[]'::json))::text;`,
  ].join('\n');
}

const diffLists = (label, got, want) => {
  const g = got.map(x => JSON.stringify(x)), w = want.map(x => JSON.stringify(x));
  const extra = g.filter(x => !w.includes(x)), missing = w.filter(x => !g.includes(x));
  return extra.length || missing.length || g.length !== w.length
    ? `${label}: +${extra.length} -${missing.length}${extra[0] ? ` first+ ${extra[0].slice(0, 160)}` : ''}${missing[0] ? ` first- ${missing[0].slice(0, 160)}` : ''}` : null;
};

export function assertRepeatTipSnapshot(contract, rows) {
  if (!Array.isArray(rows) || rows.length !== 5) throw new Error('repeat tip snapshot incomplete');
  const [ledger, functions, triggers, columns, relation] = rows.map(row => JSON.parse(row));
  if (![ledger, functions, triggers, columns].every(Array.isArray) || !relation || !Array.isArray(relation.constraints)
    || !Array.isArray(relation.indexes)) throw new Error('repeat tip snapshot incomplete');
  const applied = new Set(ledger);
  for (const version of REQUIRED_APPLIED) if (!applied.has(version)) throw new Error(`repeat tip prerequisite not applied: ${version}`);
  for (const version of MUST_REMAIN_PENDING) if (applied.has(version)) throw new Error(`repeat tip withheld migration applied: ${version}`);
  if (applied.has(contract.version) !== (contract.mode === 'after')) throw new Error('repeat tip ledger does not match the phase');
  if (contract.mode === 'before') {
    const present = [...functions.map(fn => fn.signature), ...triggers.map(t => t.name), ...columns.map(c => c.name),
      ...relation.constraints, ...relation.indexes];
    if (present.length) throw new Error(`repeat tip target objects already present: ${present.slice(0, 5).join(',')}`);
    return { mode: 'before', version: contract.version, target: 'absent' };
  }
  // No API role may execute a private helper, whatever the expectation says.
  const exposed = functions.filter(fn => Array.isArray(fn.acl) && fn.acl.length > 0).map(fn => fn.signature);
  if (exposed.length) throw new Error(`repeat tip helper executable by an API role: ${exposed.join(',')}`);
  const problems = [diffLists('functions', functions, contract.expected.functions), diffLists('triggers', triggers, contract.expected.triggers),
    diffLists('columns', columns, contract.expected.columns), diffLists('constraints', relation.constraints, contract.expected.constraints),
    diffLists('indexes', relation.indexes, contract.expected.indexes)].filter(Boolean);
  if (problems.length) throw new Error(`repeat tip catalog differs (${problems.join(' | ')})`);
  return { mode: 'after', version: contract.version, target: 'exact', functions: functions.length, triggers: triggers.length };
}
