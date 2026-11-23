// Exact, content-free catalog attestation for migration 129 (completion billing settlement, #1740). SELECT-only: no
// settlement RPC, completion row, account or billing value is read, and completion must stay OFF and unbound.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';

export const COMPLETION_SETTLEMENT_VERSION = '20261027192550';
// The production ledger window this release is reviewed against (read-only preflight, 23 November 2026): every applied
// version from 20261018090000, ending with #1906's save-journal cleanup. 129 sorts INSIDE it, so "after" is this list
// with 129 at its version-ordered position, never appended.
export const COMPLETION_SETTLEMENT_PREDECESSOR = Object.freeze([
  '20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653',
  '20261024083000', '20261025021046', '20261110173548', '20261112133000', '20261114100000',
  '20261114170000', '20261117105700', '20261119120000', '20261119200000',
]);
// The #1829 refund follow-up stays held: this release must leave it pending.
const held = Object.freeze(['20261112130000']);
const FUNCTION = 'settle_account_completion_billing_v1';
const ARGS = 'p_user_id uuid, p_request_id uuid, p_execution_id uuid, p_scope_digest text, p_subscriptions jsonb';
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = reason => { throw new Error(`completion settlement ${reason}`); };

export const completionSettlementLedger = (mode) => mode === 'after'
  ? [...COMPLETION_SETTLEMENT_PREDECESSOR, COMPLETION_SETTLEMENT_VERSION].sort()
  : [...COMPLETION_SETTLEMENT_PREDECESSOR];

export function completionSettlementContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== COMPLETION_SETTLEMENT_VERSION) fail('phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin || pin.classification !== 'staged') fail('target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) fail('source alias');
  const source = readFileSync(path, 'utf8');
  if (hash('sha256', source) !== pin.sha256) fail('source mismatch');
  const declarations = [...source.matchAll(/^CREATE FUNCTION public\.(\w+)\(\n {2}([^\n]*)\)\nRETURNS (\w+) LANGUAGE (\w+) SECURITY DEFINER SET search_path='' AS \$\$([\s\S]*?)\$\$;/gm)];
  if (declarations.length !== 1 || declarations[0][1] !== FUNCTION
    || declarations[0][2] !== 'p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_subscriptions jsonb'
    || declarations[0][3] !== 'boolean' || declarations[0][4] !== 'plpgsql') fail('source function shape mismatch');
  if ((source.match(/^CREATE /gm) || []).length !== 1) fail('source adds objects beyond the one function');
  const expectedFunction = [FUNCTION, ARGS, 'boolean', 'plpgsql', 'v', hash('md5', declarations[0][5]), true,
    ['search_path=""'], 'postgres', 'f', false, false, 'u', ['postgres:postgres:false', 'service_role:postgres:false'],
    [false, false, true]];
  return { mode, version, targetSha256: pin.sha256, expectedFunction };
}

export function completionSettlementSnapshotQuery() {
  const roles = "ARRAY['anon','authenticated','service_role']";
  return `SELECT json_build_object(
    'major', current_setting('server_version_num')::integer / 10000,
    'ledger', (SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)
      FROM supabase_migrations.schema_migrations WHERE version >= '${COMPLETION_SETTLEMENT_PREDECESSOR[0]}'),
    'functions', (SELECT COALESCE(json_agg(json_build_array(p.proname,pg_get_function_identity_arguments(p.oid),
      pg_get_function_result(p.oid),l.lanname,p.provolatile,md5(p.prosrc),p.prosecdef,p.proconfig,
      pg_get_userbyid(p.proowner),p.prokind,p.proisstrict,p.proleakproof,p.proparallel,
      (SELECT COALESCE(json_agg(pg_get_userbyid(a.grantee)||':'||pg_get_userbyid(a.grantor)||':'||a.is_grantable::text
        ORDER BY pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.is_grantable),'[]'::json)
       FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'),
      ARRAY(SELECT has_function_privilege(r,p.oid,'EXECUTE') FROM unnest(${roles}) AS x(r)))
      ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname='${FUNCTION}'),
    'completion', (SELECT json_build_object('rows',count(*),
      'disabledUnbound',COALESCE(bool_and(singleton AND NOT enabled AND scope_digest IS NULL),false))
      FROM public.account_completion_configuration))::text;`;
}

export function assertCompletionSettlementSnapshot(contract, snapshot) {
  // Production is PostgreSQL 17; 18 is admitted only because this snapshot reads nothing whose shape differs by major.
  if (!snapshot || ![17, 18].includes(snapshot.major)) fail('unsupported PostgreSQL major');
  if (!Array.isArray(snapshot.ledger) || held.some(v => snapshot.ledger.includes(v))) fail('ledger contains a withheld migration');
  if (!same(snapshot.completion, { rows: 1, disabledUnbound: true })) fail('completion is not OFF and unbound');
  const after = contract.mode === 'after';
  if (!same(snapshot.ledger, completionSettlementLedger(contract.mode))) fail('ledger does not match the phase');
  if (!after) {
    if (!same(snapshot.functions, [])) fail('target function family already present');
    return { mode: 'before', version: contract.version, target: 'absent', completion: 'off-unbound', postgresMajor: snapshot.major };
  }
  if (!same(snapshot.functions, [contract.expectedFunction])) fail('function catalog differs');
  return { mode: 'after', version: contract.version, target: 'exact', completion: 'off-unbound', postgresMajor: snapshot.major };
}
