// Exact catalog-only gate for the #1835 practice privacy migration (20261117105700). SELECT-only: it never invokes an RPC, reads a
// choice, session or account row, or writes. "before" proves the predecessor ledger and that nothing of the target exists; "after"
// proves the exact target catalog (functions, table, grants, policies, triggers), that the old coaching persist lost its API grants,
// and that no other sessions trigger moved.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';
import { functionDefinitions } from './c1MigrationPostflight.mjs';

export const PRACTICE_PRIVACY_VERSION = '20261117105700';
// Release order v2 (Sam, 18 Nov): the #1863 payment wall applies first; the two PO holds stay pending across this apply.
const REQUIRED_APPLIED = Object.freeze(['20261114100000', '20261114170000']);
const MUST_REMAIN_PENDING = Object.freeze(['20261027192550', '20261112130000']);
const BUMP = 'public.bump_practice_privacy_choice_revision_v1()';
const SET_CHOICE = 'public.set_practice_privacy_choices_v1(boolean,boolean,integer)';
const REQUIRE_OPT_IN = 'public.require_session_transcript_opt_in_v1()';
const PERSIST_WITH_CONSENT = 'public.persist_account_coaching_with_consent_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer,integer)';
const OLD_PERSIST = 'public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)';
const FUNCTIONS = Object.freeze([BUMP, SET_CHOICE, REQUIRE_OPT_IN, PERSIST_WITH_CONSENT]);
const TABLE = 'practice_privacy_choices';
const CHOICE_TRIGGER = 'practice_privacy_choice_revision';
const SESSION_TRIGGER = 'require_session_transcript_opt_in';
const API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role']);
/** Each function's exact API EXECUTE grants after the apply (PUBLIC/anon/authenticated/service_role only). */
const EXPECTED_API_EXECUTE = Object.freeze({ [BUMP]: [], [SET_CHOICE]: ['authenticated'], [REQUIRE_OPT_IN]: [],
  [PERSIST_WITH_CONSENT]: ['service_role'] });
/** Table privileges by role (relation level) and the column-level INSERT/UPDATE grants, exactly as the migration states them. */
export const EXPECTED_TABLE_PRIVILEGES = Object.freeze(['authenticated:SELECT', 'service_role:SELECT']);
export const EXPECTED_COLUMN_PRIVILEGES = Object.freeze(['ai_coaching:authenticated:INSERT', 'ai_coaching:authenticated:UPDATE',
  'transcript_save:authenticated:INSERT', 'transcript_save:authenticated:UPDATE', 'user_id:authenticated:INSERT']);
/** The reviewed choice table, as PostgreSQL renders it (derived from the exact migration bytes on PGlite, practicePrivacyMigrationPostflight.test). */
export const PRACTICE_PRIVACY_TABLE_STRUCTURE = Object.freeze({
  columns: ['user_id uuid NOT NULL', 'transcript_save boolean NOT NULL', 'ai_coaching boolean NOT NULL',
    'consent_version smallint NOT NULL DEFAULT 1', 'choice_revision integer NOT NULL DEFAULT 1',
    'changed_at timestamp with time zone NOT NULL DEFAULT statement_timestamp()'],
  constraints: ['c CHECK (((NOT ai_coaching) OR transcript_save))', 'c CHECK ((choice_revision > 0))', 'c CHECK ((consent_version = 1))',
    'f FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE', 'p PRIMARY KEY (user_id)'],
  indexes: ['CREATE UNIQUE INDEX practice_privacy_choices_pkey ON public.practice_privacy_choices USING btree (user_id) valid=true ready=true live=true'],
});
export const EXPECTED_POLICIES = Object.freeze([
  'practice_privacy_owner_insert a {authenticated} using=- check=(user_id = ( SELECT auth.uid() AS uid))',
  'practice_privacy_owner_read r {authenticated} using=(user_id = ( SELECT auth.uid() AS uid)) check=-',
  'practice_privacy_owner_update w {authenticated} using=(user_id = ( SELECT auth.uid() AS uid)) check=(user_id = ( SELECT auth.uid() AS uid))',
]);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

/** set_practice_privacy_choices_v1 RETURNS TABLE, outside the shared parser's deliberately narrow return contract: read it exactly. */
function setChoiceDefinition(source) {
  const match = /^CREATE FUNCTION public\.set_practice_privacy_choices_v1\(\s*p_transcript_save boolean, p_ai_coaching boolean, p_expected_revision integer\)\s*RETURNS TABLE \(transcript_save boolean, ai_coaching boolean, consent_version smallint, choice_revision integer\)\s*LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''\s*AS (\$\$)([\s\S]*?)\1;/m.exec(source);
  if (!match) throw new Error('practice privacy source shape unavailable: set choice');
  return { signature: SET_CHOICE, bodyMd5: createHash('md5').update(match[2]).digest('hex'), language: 'plpgsql',
    securityDefiner: false, volatility: 'v', config: ['search_path=""'] };
}

export function practicePrivacyContract(root, mode, version) {
  if (!['before', 'after'].includes(mode) || version !== PRACTICE_PRIVACY_VERSION) throw new Error('practice privacy phase/target invalid');
  const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
  if (!pin) throw new Error('practice privacy target is not allowlisted');
  const path = join(root, 'backend/supabase/migrations', pin.file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error('practice privacy source alias');
  const source = readFileSync(path, 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== pin.sha256) throw new Error('practice privacy source mismatch');
  const parsed = functionDefinitions(source);
  const definitions = [...parsed, setChoiceDefinition(source)];
  if (parsed.length !== FUNCTIONS.length - 1) throw new Error('practice privacy function source shape unavailable');
  const functions = FUNCTIONS.map(signature => {
    const found = definitions.filter(fn => fn.signature === signature);
    if (found.length !== 1) throw new Error(`practice privacy source shape unavailable: ${signature}`);
    return { signature, expected: found[0] };
  });
  return { mode, version, targetSha256: pin.sha256, functions };
}

/** Six rows, each one JSON value: ledger, the four functions, the old persist ACL, the table, its policies, every sessions trigger. */
export function practicePrivacySnapshotQuery() {
  const versions = [...REQUIRED_APPLIED, ...MUST_REMAIN_PENDING, PRACTICE_PRIVACY_VERSION].map(literal).join(',');
  const acl = `COALESCE((SELECT json_agg(r ORDER BY r) FROM (SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS r
        FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE') g),'[]'::json)`;
  const fn = signature => `COALESCE((SELECT json_build_object('exists',true,'md5',md5(p.prosrc),'definer',p.prosecdef,
      'config',p.proconfig,'language',l.lanname,'volatility',p.provolatile::text,'acl',${acl})
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(signature)})),json_build_object('exists',false))`;
  const table = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=${literal(TABLE)})`;
  return [
    `SELECT COALESCE(json_agg(version ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations WHERE version IN (${versions});`,
    `SELECT json_build_array(${FUNCTIONS.map(fn).join(',')})::text;`,
    `SELECT COALESCE((SELECT ${acl} FROM pg_proc p WHERE p.oid=to_regprocedure(${literal(OLD_PERSIST)})),'null'::json)::text;`,
    `SELECT COALESCE((SELECT json_build_object('exists',true,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
        'privileges',(SELECT COALESCE(json_agg(DISTINCT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type
            ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type),'[]'::json)
          FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
          WHERE a.grantee=0 OR pg_get_userbyid(a.grantee) IN (${API_ROLES.map(literal).join(',')})),
        'columnPrivileges',(SELECT COALESCE(json_agg(x ORDER BY x),'[]'::json) FROM (SELECT at.attname||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type AS x FROM pg_attribute at, aclexplode(at.attacl) a
          WHERE at.attrelid=c.oid AND at.attnum>0 AND NOT at.attisdropped AND at.attacl IS NOT NULL
            AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN (${API_ROLES.map(literal).join(',')}))) cp),
        'structure',json_build_object(
          'columns',(SELECT json_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
              ||COALESCE(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),'') ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
          'constraints',(SELECT json_agg(k.contype::text||' '||pg_get_constraintdef(k.oid) ORDER BY k.contype::text, pg_get_constraintdef(k.oid))
            FROM pg_constraint k WHERE k.conrelid=c.oid AND NOT (k.contype = 'n' AND k.convalidated AND NOT k.connoinherit)),
          'indexes',(SELECT json_agg(pg_get_indexdef(i.indexrelid)||' valid='||i.indisvalid::text||' ready='||i.indisready::text
              ||' live='||i.indislive::text ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid)))
      FROM pg_class c WHERE c.oid=${table}),json_build_object('exists',false))::text;`,
    `SELECT COALESCE((SELECT json_agg(p.polname||' '||p.polcmd::text||' '||(SELECT COALESCE(array_agg(pg_get_userbyid(r) ORDER BY pg_get_userbyid(r))::text,'{}')
          FROM unnest(p.polroles) r)||' using='||COALESCE(pg_get_expr(p.polqual,p.polrelid),'-')||' check='||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'-')
          ||CASE WHEN p.polpermissive THEN '' ELSE ' RESTRICTIVE' END ORDER BY p.polname)
        FROM pg_policy p WHERE p.polrelid=${table}),'[]'::json)::text;`,
    `SELECT COALESCE(json_agg(json_build_object('table',rn.nspname||'.'||rc.relname,'name',t.tgname,'function',p.pronamespace::regnamespace::text||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
        'type',t.tgtype,'enabled',t.tgenabled::text,'conditional',t.tgqual IS NOT NULL,'columns',cardinality(t.tgattr::int2[]),'args',t.tgnargs,
        'definition',pg_get_triggerdef(t.oid,false)) ORDER BY rn.nspname||'.'||rc.relname, t.tgname),'[]'::json)::text
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class rc ON rc.oid=t.tgrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE NOT t.tgisinternal
        AND (t.tgrelid=to_regclass('public.sessions') OR t.tgrelid=to_regclass('public.${TABLE}'));`,
  ].join('\n');
}

function assertFunction(actual, expected, label) {
  if (!actual || actual.exists !== true) throw new Error(`practice privacy ${label} absent`);
  if (actual.md5 !== expected.bodyMd5 || actual.definer !== expected.securityDefiner || actual.language !== expected.language
    || actual.volatility !== expected.volatility || JSON.stringify(actual.config ?? null) !== JSON.stringify(expected.config)) {
    throw new Error(`practice privacy ${label} shape differs from source`);
  }
}
const apiGrants = roles => (roles ?? []).filter(role => role === 'PUBLIC' || API_ROLES.includes(role));

export function assertPracticePrivacySnapshot(contract, rows, prior) {
  const expectedStructure = PRACTICE_PRIVACY_TABLE_STRUCTURE;
  if (!Array.isArray(rows) || rows.length !== 6) throw new Error('practice privacy snapshot incomplete');
  const [ledger, functions, oldPersist, table, policies, triggers] = rows.map(row => JSON.parse(row));
  const applied = new Set(ledger);
  for (const version of REQUIRED_APPLIED) if (!applied.has(version)) throw new Error(`practice privacy prerequisite not applied: ${version}`);
  for (const version of MUST_REMAIN_PENDING) if (applied.has(version)) throw new Error(`practice privacy withheld migration applied: ${version}`);
  if (applied.has(contract.version) !== (contract.mode === 'after')) throw new Error('practice privacy ledger does not match the phase');
  if (!Array.isArray(functions) || functions.length !== FUNCTIONS.length || !Array.isArray(triggers) || !Array.isArray(policies)) {
    throw new Error('practice privacy snapshot incomplete');
  }
  // The old persist must exist in both phases (the migration revokes it; it does not drop it).
  if (!Array.isArray(oldPersist)) throw new Error('practice privacy predecessor persist absent');
  const targetTriggers = triggers.filter(t => t.name === CHOICE_TRIGGER || t.name === SESSION_TRIGGER
    || [BUMP, REQUIRE_OPT_IN].includes(t.function));
  if (contract.mode === 'before') {
    if (functions.some(fn => fn.exists !== false) || table.exists !== false || policies.length !== 0 || targetTriggers.length !== 0) {
      throw new Error('practice privacy target objects already present');
    }
    if (!apiGrants(oldPersist).includes('service_role')) throw new Error('practice privacy predecessor persist grant absent');
  } else {
    contract.functions.forEach((entry, index) => assertFunction(functions[index], entry.expected, entry.signature));
    for (const [index, signature] of FUNCTIONS.entries()) {
      if (JSON.stringify(apiGrants(functions[index].acl)) !== JSON.stringify(EXPECTED_API_EXECUTE[signature])) {
        throw new Error(`practice privacy ACL differs: ${signature}`);
      }
    }
    if (apiGrants(oldPersist).length !== 0) throw new Error('practice privacy old persist still executable by an API role');
    if (table.exists !== true || table.rls !== true || table.forceRls !== false
      || JSON.stringify(table.privileges) !== JSON.stringify(EXPECTED_TABLE_PRIVILEGES)
      || JSON.stringify(table.columnPrivileges) !== JSON.stringify(EXPECTED_COLUMN_PRIVILEGES)) {
      throw new Error('practice privacy table grants differ');
    }
    if (JSON.stringify(table.structure) !== JSON.stringify(expectedStructure)) {
      const diff = ['columns', 'constraints', 'indexes'].flatMap((part) => {
        const got = table.structure?.[part] ?? [], want = expectedStructure?.[part] ?? [];
        return [...got.filter((x) => !want.includes(x)).map((x) => `+${part}: ${x}`), ...want.filter((x) => !got.includes(x)).map((x) => `-${part}: ${x}`)];
      });
      throw new Error(`practice privacy table structure differs (${diff.join(' | ') || 'order'})`);
    }
    if (JSON.stringify(policies) !== JSON.stringify(EXPECTED_POLICIES)) throw new Error('practice privacy policies differ');
    // BEFORE UPDATE FOR EACH ROW (19) on the choice table; BEFORE INSERT OR UPDATE OF transcript FOR EACH ROW (23, one column) on
    // sessions. Both enabled, unconditional, no arguments.
    const choice = targetTriggers.filter(t => t.name === CHOICE_TRIGGER);
    const session = targetTriggers.filter(t => t.name === SESSION_TRIGGER);
    if (targetTriggers.length !== 2 || choice.length !== 1 || session.length !== 1) throw new Error('practice privacy triggers differ');
    const [c] = choice, [s] = session;
    if (c.table !== `public.${TABLE}` || c.function !== BUMP || c.type !== 19 || c.enabled !== 'O' || c.conditional || c.columns !== 0 || c.args !== 0
      || s.table !== 'public.sessions' || s.function !== REQUIRE_OPT_IN || s.type !== 23 || s.enabled !== 'O' || s.conditional || s.columns !== 1 || s.args !== 0
      || !/BEFORE INSERT OR UPDATE OF transcript ON public\.sessions FOR EACH ROW EXECUTE FUNCTION require_session_transcript_opt_in_v1\(\)$/.test(s.definition)) {
      throw new Error('practice privacy triggers differ');
    }
    if (!prior || prior.version !== contract.version || prior.targetSha256 !== contract.targetSha256 || !Array.isArray(prior.rows)) {
      throw new Error('practice privacy prior receipt missing or mismatched');
    }
    // Every other sessions trigger is exactly the predecessor's, by its complete definition.
    const others = JSON.stringify(triggers.filter(t => t.table === 'public.sessions' && t.name !== SESSION_TRIGGER));
    if (others !== JSON.stringify(JSON.parse(prior.rows[5]).filter(t => t.table === 'public.sessions'))) {
      throw new Error('practice privacy changed another sessions trigger');
    }
  }
  return { mode: contract.mode, version: contract.version, target: contract.mode === 'after' ? 'exact' : 'absent' };
}
