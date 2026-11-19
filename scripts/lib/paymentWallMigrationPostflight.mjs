// Exact catalog-only gate for the #1863 payment wall migration (20261114170000). SELECT-only: it never invokes an RPC, reads an
// account, session or product row, or writes. The migration renames 15 product RPCs to <name>__unguarded and installs guarded
// wrappers, adds three access functions, replaces the owner read policies on 17 tables, adds an evaluation-table guard trigger and
// the closure discard for unsaved recordings. "before" proves the predecessor ledger and that no target object exists; "after" proves the whole
// touched catalog equals the reviewed expectation (paymentWallMigrationCatalog.json), which the offline test re-derives from the
// exact migration bytes on PGlite, so it cannot drift from the source.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';

export const PAYMENT_WALL_VERSION = '20261114170000';
const REQUIRED_APPLIED = Object.freeze(['20261114100000']);
const MUST_REMAIN_PENDING = Object.freeze(['20261027192550', '20261112130000']);
export const GUARDED_RPCS = Object.freeze([
  'get_analytics_summary', 'get_progress_obligations', 'get_attribution_authority_v1', 'get_session_engine_class_v1',
  'issue_objective_project_v1', 'issue_objective_brief_v1', 'objective_start_session_v1', 'objective_select_action_v1',
  'objective_finalize_evidence_v1', 'objective_dispute_action_v1', 'record_progress_recommendation', 'record_recommendation_attempt',
  'advance_recommendation_attempt', 'consume_ai_suggestion_quota', 'consume_formatter_quota']);
/** Created by this migration: absent before it, exact after. */
export const NEW_FUNCTIONS = Object.freeze(['account_has_product_access', 'current_account_has_product_access', 'require_product_access',
  '_ss_payment_wall_evaluation_guard', 'discard_unsaved_recordings_for_closure_v1', ...GUARDED_RPCS.map(name => `${name}__unguarded`)]);
/** Renamed to <name>__unguarded and re-created as guarded wrappers: present in both phases, exact after. */
export const REPLACED_FUNCTIONS = Object.freeze([...GUARDED_RPCS]);
export const POLICY_TABLES = Object.freeze(['objective_action', 'objective_action_dispute', 'objective_brief', 'objective_brief_point',
  'objective_evidence', 'objective_project', 'objective_session', 'objective_source_recording', 'progress_recommendation_attempts',
  'progress_recommendations', 'session_attribution_authority', 'session_attribution_challenge', 'session_attribution_unattributed',
  'session_progress_evaluations', 'sessions', 'user_filler_words', 'user_goals']);
const TRIGGER = 'ss_payment_wall_evaluation_guard';
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function paymentWallContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== PAYMENT_WALL_VERSION) throw new Error('payment wall phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin) throw new Error('payment wall target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('payment wall source alias');
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== pin.sha256) throw new Error('payment wall source mismatch');
  const catalogPath = join(root, 'scripts/lib/paymentWallMigrationCatalog.json');
  if (!lstatSync(catalogPath).isFile() || realpathSync(catalogPath) !== catalogPath) throw new Error('payment wall expectation alias');
  const expected = JSON.parse(readFileSync(catalogPath, 'utf8'));
  if (expected.version !== version || expected.targetSha256 !== pin.sha256) throw new Error('payment wall expectation is not for this source');
  return { mode, version, targetSha256: pin.sha256, expected };
}

/** Four rows, each one JSON value: ledger, every touched function overload, every policy on the 17 tables, the guard trigger. */
export function paymentWallSnapshotQuery() {
  const versions = [...REQUIRED_APPLIED, ...MUST_REMAIN_PENDING, PAYMENT_WALL_VERSION].map(literal).join(',');
  const names = [...NEW_FUNCTIONS, ...REPLACED_FUNCTIONS].map(literal).join(',');
  const tables = POLICY_TABLES.map(literal).join(',');
  return [
    `SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations WHERE version IN (${versions});`,
    `SELECT COALESCE(json_agg(json_build_object('signature','public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        'md5',md5(p.prosrc),'definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile::text,
        'returns',pg_get_function_result(p.oid),
        'acl',COALESCE((SELECT json_agg(r ORDER BY r) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS r
          FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'
            AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN (${API_ROLES.map(literal).join(',')}))) g),'[]'::json))
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)),'[]'::json)::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname IN (${names});`,
    `SELECT COALESCE(json_agg(c.relname||' '||p.polname||' '||p.polcmd::text||' '||(SELECT COALESCE(array_agg(pg_get_userbyid(r) ORDER BY pg_get_userbyid(r))::text,'{}')
          FROM unnest(p.polroles) r)||' using='||COALESCE(pg_get_expr(p.polqual,p.polrelid),'-')||' check='||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'-')
          ||CASE WHEN p.polpermissive THEN '' ELSE ' RESTRICTIVE' END ORDER BY c.relname, p.polname),'[]'::json)::text
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN (${tables});`,
    `SELECT COALESCE(json_agg(json_build_object('table',rn.nspname||'.'||rc.relname,'name',t.tgname,
        'function','public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','type',t.tgtype,'enabled',t.tgenabled::text,
        'conditional',t.tgqual IS NOT NULL,'columns',cardinality(t.tgattr::int2[]),'args',t.tgnargs,'definition',pg_get_triggerdef(t.oid,false))
        ORDER BY t.tgname),'[]'::json)::text
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class rc ON rc.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE NOT t.tgisinternal AND rn.nspname='public' AND (t.tgname=${literal(TRIGGER)} OR p.proname='_ss_payment_wall_evaluation_guard');`,
  ].join('\n');
}

const nameOf = signature => signature.slice('public.'.length, signature.indexOf('('));
const diffLists = (label, got, want) => {
  const g = got.map(x => JSON.stringify(x)), w = want.map(x => JSON.stringify(x));
  const extra = g.filter(x => !w.includes(x)), missing = w.filter(x => !g.includes(x));
  return extra.length || missing.length || g.length !== w.length
    ? `${label}: +${extra.length} -${missing.length}${extra[0] ? ` first+ ${extra[0].slice(0, 160)}` : ''}${missing[0] ? ` first- ${missing[0].slice(0, 160)}` : ''}` : null;
};

export function assertPaymentWallSnapshot(contract, rows) {
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('payment wall snapshot incomplete');
  const [ledger, functions, policies, triggers] = rows.map(row => JSON.parse(row));
  if (![ledger, functions, policies, triggers].every(Array.isArray)) throw new Error('payment wall snapshot incomplete');
  const applied = new Set(ledger);
  for (const version of REQUIRED_APPLIED) if (!applied.has(version)) throw new Error(`payment wall prerequisite not applied: ${version}`);
  for (const version of MUST_REMAIN_PENDING) if (applied.has(version)) throw new Error(`payment wall withheld migration applied: ${version}`);
  if (applied.has(contract.version) !== (contract.mode === 'after')) throw new Error('payment wall ledger does not match the phase');
  const present = new Set(functions.map(fn => nameOf(fn.signature)));
  if (contract.mode === 'before') {
    const early = NEW_FUNCTIONS.filter(name => present.has(name));
    if (early.length || triggers.length) throw new Error(`payment wall target objects already present: ${[...early, ...triggers.map(t => t.name)].join(',')}`);
    const missing = REPLACED_FUNCTIONS.filter(name => !present.has(name));
    if (missing.length) throw new Error(`payment wall predecessor functions absent: ${missing.join(',')}`);
    return { mode: 'before', version: contract.version, target: 'absent', functions: functions.length, policies: policies.length };
  }
  const problems = [diffLists('functions', functions, contract.expected.functions), diffLists('policies', policies, contract.expected.policies),
    diffLists('trigger', triggers, contract.expected.triggers)].filter(Boolean);
  if (problems.length) throw new Error(`payment wall catalog differs (${problems.join(' | ')})`);
  return { mode: 'after', version: contract.version, target: 'exact', functions: functions.length, policies: policies.length };
}
