import { createHash } from 'node:crypto';

export const ACCOUNT_CLOSURE_DRAIN_SHA256 = 'd8a5b1d153890167869b2e7d366fb1ae3dd1272a67cd26f3980e6d2cd5233145';
// Logical pg_catalog identities derived from the pinned SQL; no environment OIDs.
const tables = {
    account_closure_attestation_state: '97ae92721a822b2a3c5ef5b896cffb26',
    account_closure_drain_attestations: '5cd2f705714100751d0afbc2b79dd5fd',
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const names = {
    before: ['drain_tables_absent', 'drain_routines_absent'],
    after: ['drain_routine_inventory', 'drain_routine_identity_acl', 'drain_tables_closed_rls', 'drain_table_identity'],
    initial: ['fresh_generation', 'empty_attestations'],
};

export function accountClosureDrainQuery(mode, source) {
    if (!['before', 'after'].includes(mode)) throw new Error('expected before or after');
    if (createHash('sha256').update(source).digest('hex') !== ACCOUNT_CLOSURE_DRAIN_SHA256) {
        throw new Error('drain persistence source checksum mismatch');
    }
    const definitions = [...source.matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?RETURNS (\w+) LANGUAGE (\w+)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
    const signatures = [...source.matchAll(/GRANT EXECUTE ON FUNCTION public\.([^;]+) TO service_role;/g)];
    if (definitions.length !== 2 || signatures.length !== 2) throw new Error('unexpected drain routine inventory');
    const expected = definitions.map(([, name, result, language, body]) => {
        const signature = signatures.find(([, signature]) => signature.startsWith(`${name}(`))?.[1];
        if (!signature) throw new Error('missing drain signature');
        return `(${literal(name)},${literal(`public.${signature}`)},${literal(result)},${literal(language)},${literal(createHash('md5').update(body).digest('hex'))})`;
    }).join(',');
    const tableNames = Object.keys(tables).map(literal).join(',');
    const checks = mode === 'before' ? `
      SELECT 'drain_tables_absent' AS name, NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN (${tableNames})) AS ok
      UNION ALL SELECT 'drain_routines_absent', NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected))
    ` : `
      SELECT 'drain_routine_inventory' AS name, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected))=2 AS ok
      UNION ALL SELECT 'drain_routine_identity_acl', NOT EXISTS(SELECT 1 FROM expected e
        LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
        LEFT JOIN pg_language l ON l.oid=p.prolang
        WHERE p.oid IS NULL OR md5(p.prosrc)<>e.digest OR NOT p.prosecdef OR l.lanname<>e.language
          OR pg_get_function_result(p.oid)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
          OR p.proowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.account_billing_coordination'))
          OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
          OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
          OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.grantee<>p.proowner AND a.grantee IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='service_role')))
      UNION ALL SELECT 'drain_tables_closed_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN (${tableNames}) AND c.relkind='r')=2
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN (${tableNames}) AND
            (NOT c.relrowsecurity OR c.relowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.account_billing_coordination'))
              OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
              OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
              OR EXISTS(SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND acl.grantee<>c.relowner)
              OR has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
              OR has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
              OR has_any_column_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      UNION ALL SELECT 'drain_table_identity', NOT EXISTS(SELECT 1 FROM
        (VALUES ${Object.entries(tables).map(([name, digest]) => `(${literal(name)},${literal(digest)})`).join(',')}) AS t(name,digest)
        LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||t.name)
        WHERE c.oid IS NULL OR md5(jsonb_build_object('columns',
          (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped), 'constraints',
          (SELECT jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid)) ORDER BY x.conname)
            FROM pg_constraint x WHERE x.conrelid=c.oid AND x.contype<>'n'))::text)<>t.digest)
    `;
    return `WITH expected(name,signature,result_type,language,digest) AS (VALUES ${expected}), checks AS (${checks})
      SELECT json_build_object('mode',${literal(`drain-${mode}`)},'checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;
}

// Run only after catalog identity passed, in the same read-only snapshot. This
// is an apply postflight, not a later permission to reuse registered evidence.
export const accountClosureDrainInitialQuery = `WITH checks AS (
  SELECT 'fresh_generation' AS name, count(*)=1 AND coalesce(bool_and(singleton AND generation=0 AND binding_digest IS NULL),false) AS ok
    FROM public.account_closure_attestation_state
  UNION ALL SELECT 'empty_attestations', NOT EXISTS(SELECT 1 FROM public.account_closure_drain_attestations))
  SELECT json_build_object('mode','drain-initial','checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;

export function assertAccountClosureDrain(result, mode) {
    const value = typeof result === 'string' ? JSON.parse(result) : result;
    const required = names[mode];
    if (!required || value?.mode !== `drain-${mode}` || value.passed !== true || !value.checks
        || Object.keys(value.checks).length !== required.length || required.some((name) => value.checks[name] !== true)) {
        throw new Error('drain persistence verification failed');
    }
    return value;
}
