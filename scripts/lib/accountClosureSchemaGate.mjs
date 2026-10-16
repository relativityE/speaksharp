import { createHash } from 'node:crypto';

export const ACCOUNT_CLOSURE_SHA256 = '150879ed64cd5ded4b1d6a7c6111e69ebe9042b59a706fa6757ec4d8e1a43100';
const tables = ['account_closure_tokens', 'account_closure_attempts', 'account_billing_fences',
    'account_checkout_operations', 'account_billing_coordination', 'account_closure_billing_permits'];
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

// Generate SELECT-only catalog checks from immutable reviewed migration bytes.
// This verifies schema deployment, never legacy-worker drain or rollout permission.
export function accountClosureSchemaQuery(mode, source) {
    if (!['before', 'after'].includes(mode)) throw new Error('expected before or after');
    if (createHash('sha256').update(source).digest('hex') !== ACCOUNT_CLOSURE_SHA256) {
        throw new Error('account closure migration source checksum mismatch');
    }
    const definitions = [...source.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(\w+)\([\s\S]*?RETURNS ([\s\S]*?)\s+LANGUAGE (\w+)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
    const grants = [...source.matchAll(/GRANT EXECUTE ON FUNCTION public\.([^;]+) TO service_role;/g)];
    if (definitions.length !== 19 || grants.length !== 17) throw new Error('unexpected routine inventory');
    const signatures = new Map(grants.map(([, signature]) => [signature.split('(')[0], signature.replaceAll(' ', '')]));
    signatures.set('guard_account_closure_billing', 'guard_account_closure_billing()');
    signatures.set('ensure_trial_profile_for_new_user', 'ensure_trial_profile_for_new_user()');
    const expected = definitions.map(([, name, returns, language, body]) => {
        const signature = signatures.get(name);
        if (!signature) throw new Error(`routine signature missing: ${name}`);
        const resultType = returns.toLowerCase().replaceAll(/\s/g, '').replaceAll('timestamptz', 'timestampwithtimezone');
        return `(${literal(name)}, ${literal(`public.${signature}`)}, ${literal(createHash('md5').update(body).digest('hex'))}, ${literal(resultType)}, ${literal(language)}, ${!['guard_account_closure_billing', 'ensure_trial_profile_for_new_user'].includes(name)})`;
    }).join(',\n');
    const tableNames = tables.map(literal).join(',');
    const checks = mode === 'before' ? `
      SELECT 'tables_absent' AS name, NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN (${tableNames})) AS ok
      UNION ALL SELECT 'routines_absent', NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected WHERE name<>'ensure_trial_profile_for_new_user'))
      UNION ALL SELECT 'billing_guard_absent', NOT EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgrelid=to_regclass('public.user_profiles') AND tgname='account_closure_billing_guard')
    ` : `
      SELECT 'exact_routine_inventory' AS name, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN (SELECT name FROM expected))=19 AS ok
      UNION ALL SELECT 'routine_identity_and_acl', NOT EXISTS(SELECT 1 FROM expected e
        LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
        LEFT JOIN pg_language l ON l.oid=p.prolang
        WHERE p.oid IS NULL OR md5(p.prosrc)<>e.digest OR NOT p.prosecdef OR l.lanname<>e.language
          OR regexp_replace(lower(pg_get_function_result(p.oid)), '\\s+', '', 'g')<>e.result_type
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
          OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM e.service_exec
          OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
          OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
      UNION ALL SELECT 'tables_closed_and_rls', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN (${tableNames}) AND c.relkind='r')=6
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN (${tableNames}) AND
            (NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
              OR EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
                WHERE a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))))
      UNION ALL SELECT 'billing_guard_enabled', EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgrelid=to_regclass('public.user_profiles') AND tgname='account_closure_billing_guard'
          AND tgfoid=to_regprocedure('public.guard_account_closure_billing()') AND tgenabled='O' AND NOT tgisinternal
          AND tgtype=23 AND tgattr::text='' AND tgqual IS NULL AND tgnargs=0 AND octet_length(tgargs)=0
          AND tgconstraint=0 AND tgconstrrelid=0 AND NOT tgdeferrable AND NOT tginitdeferred
          AND tgoldtable IS NULL AND tgnewtable IS NULL)
    `;
    // Do not access a missing table: callers run catalog checks first, then the
    // separately exported SELECT for the default-disabled activation boundary.
    return `WITH expected(name,signature,digest,result_type,language,service_exec) AS (VALUES ${expected}),
      checks AS (${checks}) SELECT json_build_object('mode',${literal(mode)},
        'checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;
}

export const accountClosureDisabledQuery = `SELECT json_build_object('mode','disabled',
  'checks',json_build_object('rollout_disabled',count(*)=1 AND bool_and(singleton AND NOT checkout_workers_drained AND evidence_reference IS NULL)),
  'passed',count(*)=1 AND coalesce(bool_and(singleton AND NOT checkout_workers_drained AND evidence_reference IS NULL),false))::text
  FROM public.account_billing_coordination;`;

export function assertAccountClosureSchema(result, expectedMode) {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const names = { before: ['tables_absent', 'routines_absent', 'billing_guard_absent'],
        after: ['exact_routine_inventory', 'routine_identity_and_acl', 'tables_closed_and_rls', 'billing_guard_enabled'],
        disabled: ['rollout_disabled'] }[expectedMode];
    if (!names || parsed?.mode !== expectedMode || parsed?.passed !== true || !parsed.checks
        || Object.keys(parsed.checks).length !== names.length || names.some((name) => parsed.checks[name] !== true)) {
        throw new Error(`account closure ${expectedMode} schema gate failed`);
    }
    return { mode: expectedMode, passed: true, checks: parsed.checks };
}

export function assertAccountClosureTerminal(outputs, mode) {
    const modes = mode === 'before' ? ['before'] : mode === 'after' ? ['after', 'disabled'] : [];
    if (!modes.length || outputs.length !== modes.length) throw new Error('incomplete schema verification');
    const stages = outputs.map((output, index) => assertAccountClosureSchema(output, modes[index]));
    return { mode, passed: true, stages };
}
