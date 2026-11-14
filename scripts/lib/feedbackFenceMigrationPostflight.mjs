// Exact catalog-only gate for the #1811 AHT-01/02/07/08 feedback fence migration (20261114100000). SELECT-only: it never
// invokes an RPC, reads report or account data, or writes. "before" proves the installed predecessor state and that nothing
// of the target exists; "after" proves the exact target catalog, the write trigger, and that no other report trigger moved.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';
import { functionDefinitions } from './c1MigrationPostflight.mjs';

export const FEEDBACK_FENCE_VERSION = '20261114100000';
// Applied before this target and pending after it (PO holds); both must keep the same state across the apply.
const REQUIRED_APPLIED = Object.freeze(['20261112133000']);
const MUST_REMAIN_PENDING = Object.freeze(['20261027192550', '20261112130000']);
const TRIGGER_FUNCTION = 'public._rwt_feedback_fence_v1()';
const RPCS = Object.freeze(['public.open_rwt_feedback_fence_v1(uuid,jsonb,text,integer)',
  'public.close_rwt_feedback_fence_v1(text)', 'public.clean_rwt_feedback_fence_v1(text)', 'public.verify_rwt_feedback_fence_v1(text)']);
const FUNCTIONS = Object.freeze([TRIGGER_FUNCTION, ...RPCS]);
const TABLE = 'rwt_feedback_fences';
const TRIGGER = 'zz_rwt_feedback_fence';
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function feedbackFenceContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== FEEDBACK_FENCE_VERSION) throw new Error('feedback fence phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin) throw new Error('feedback fence target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('feedback fence source alias');
  const source = readFileSync(path, 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== pin.sha256) throw new Error('feedback fence source mismatch');
  const definitions = functionDefinitions(source);
  if (definitions.length !== FUNCTIONS.length) throw new Error('feedback fence function source shape unavailable');
  const functions = FUNCTIONS.map(signature => {
    const found = definitions.filter(fn => fn.signature === signature);
    if (found.length !== 1) throw new Error(`feedback fence source shape unavailable: ${signature}`);
    return { signature, expected: found[0] };
  });
  return { mode, version, targetSha256: pin.sha256, functions };
}

/** Four rows, each one JSON value: ledger, the five functions, the fence table, every trigger on user_issue_reports. */
export function feedbackFenceSnapshotQuery() {
  const versions = [...REQUIRED_APPLIED, ...MUST_REMAIN_PENDING, FEEDBACK_FENCE_VERSION].map(literal).join(',');
  const fn = signature => `COALESCE((SELECT json_build_object('exists',true,'md5',md5(p.prosrc),'definer',p.prosecdef,
      'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile::text,
      'acl',COALESCE((SELECT json_agg(r ORDER BY r) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS r
        FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') g),'[]'::json))
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(signature)})),json_build_object('exists',false))`;
  return [
    `SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations WHERE version IN (${versions});`,
    `SELECT json_build_array(${FUNCTIONS.map(fn).join(',')})::text;`,
    `SELECT COALESCE((SELECT json_build_object('exists',true,'rls',c.relrowsecurity,
        'apiPrivileges',(SELECT COALESCE(json_agg(DISTINCT pg_get_userbyid(a.grantee) ORDER BY pg_get_userbyid(a.grantee)),'[]'::json)
          FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>0 AND pg_get_userbyid(a.grantee) IN (${API_ROLES.map(literal).join(',')})),
        'publicPrivileges',(SELECT count(*) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${literal(TABLE)}),
      json_build_object('exists',false))::text;`,
    `SELECT COALESCE(json_agg(json_build_object('name',t.tgname,'function',p.pronamespace::regnamespace::text||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','type',t.tgtype,'enabled',t.tgenabled::text)
        ORDER BY t.tgname),'[]'::json)::text
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgrelid=to_regclass('public.user_issue_reports');`,
  ].join('\n');
}

function assertFunction(actual, expected, label) {
  if (!actual || actual.exists !== true) throw new Error(`feedback fence ${label} absent`);
  if (actual.md5 !== expected.bodyMd5 || actual.definer !== expected.securityDefiner || actual.language !== expected.language
    || actual.volatility !== expected.volatility || JSON.stringify(actual.config ?? null) !== JSON.stringify(expected.config)) {
    throw new Error(`feedback fence ${label} shape differs from source`);
  }
}

export function assertFeedbackFenceSnapshot(contract, rows, prior) {
  if (!Array.isArray(rows) || rows.length !== 4) throw new Error('feedback fence snapshot incomplete');
  const [ledger, functions, table, triggers] = rows.map(row => JSON.parse(row));
  const applied = new Set(ledger);
  for (const version of REQUIRED_APPLIED) if (!applied.has(version)) throw new Error(`feedback fence prerequisite not applied: ${version}`);
  for (const version of MUST_REMAIN_PENDING) if (applied.has(version)) throw new Error(`feedback fence withheld migration applied: ${version}`);
  if (applied.has(contract.version) !== (contract.mode === 'after')) throw new Error('feedback fence ledger does not match the phase');
  if (!Array.isArray(functions) || functions.length !== FUNCTIONS.length || !Array.isArray(triggers)) throw new Error('feedback fence snapshot incomplete');
  const fenceTriggers = triggers.filter(t => t.name === TRIGGER || t.function === TRIGGER_FUNCTION);
  if (contract.mode === 'before') {
    if (functions.some(fn => fn.exists !== false) || table.exists !== false || fenceTriggers.length !== 0) {
      throw new Error('feedback fence target objects already present');
    }
  } else {
    contract.functions.forEach((entry, index) => assertFunction(functions[index], entry.expected, entry.signature));
    // The trigger function is reachable only through the trigger; the RPCs only by the service role. Never PUBLIC/anon/authenticated.
    const apiGrants = fn => fn.acl.filter(role => role === 'PUBLIC' || API_ROLES.includes(role));
    if (apiGrants(functions[0]).length !== 0) throw new Error('feedback fence trigger function ACL differs');
    for (const fn of functions.slice(1)) {
      if (JSON.stringify(apiGrants(fn)) !== JSON.stringify(['service_role'])) throw new Error('feedback fence RPC ACL differs');
    }
    if (table.exists !== true || table.rls !== true || table.apiPrivileges.length !== 0 || table.publicPrivileges !== 0) {
      throw new Error('feedback fence table shape differs');
    }
    // BEFORE INSERT FOR EACH ROW (tgtype 7 = ROW|BEFORE|INSERT), enabled, calling the exact trigger function.
    if (fenceTriggers.length !== 1 || fenceTriggers[0].name !== TRIGGER || fenceTriggers[0].function !== TRIGGER_FUNCTION
      || fenceTriggers[0].type !== 7 || fenceTriggers[0].enabled !== 'O') {
      throw new Error('feedback fence write trigger differs');
    }
    if (!prior || prior.version !== contract.version || prior.targetSha256 !== contract.targetSha256 || !Array.isArray(prior.rows)) {
      throw new Error('feedback fence prior receipt missing or mismatched');
    }
    // Every other report trigger (ownership guard, kind/severity contract, ...) is exactly the predecessor's.
    const others = JSON.stringify(triggers.filter(t => t.name !== TRIGGER));
    if (others !== JSON.stringify(JSON.parse(prior.rows[3]))) throw new Error('feedback fence changed another report trigger');
  }
  return { mode: contract.mode, version: contract.version, target: contract.mode === 'after' ? 'exact' : 'absent' };
}
