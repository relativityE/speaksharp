import { createHash } from 'node:crypto';
import { ACCOUNT_CLOSURE_ENFORCEMENT_SHA256, CLOSURE_OWNER_ONLY_ROUTINES } from './accountClosureEnforcementIdentity.mjs';
import { accountClosureSchemaQuery, accountClosureDisabledQuery, assertAccountClosureSchema } from './accountClosureSchemaGate.mjs';
import { accountClosureRolloutQuery, assertAccountClosureRollout } from './accountClosureRolloutGate.mjs';
import { accountClosureDrainQuery, assertAccountClosureDrain } from './accountClosureDrainGate.mjs';

const literal = (v) => `'${v.replaceAll("'", "''")}'`;
const names = { before: ['enforcement_routines_absent', 'journal_binding_absent'],
    after: ['enforcement_inventory', 'enforcement_routine_identity_acl', 'legacy_owner_only', 'journal_columns_private'],
    initial: ['historical_requests_unbound'] };
export function accountClosureEnforcementQuery(mode, source) {
    if (!['before', 'after'].includes(mode) || createHash('sha256').update(source).digest('hex') !== ACCOUNT_CLOSURE_ENFORCEMENT_SHA256) {
        throw new Error('invalid enforcement mode/source checksum');
    }
    const definitions = [...source.matchAll(/CREATE FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*RETURNS ([\s\S]*?)\s+LANGUAGE (\w+)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
    if (definitions.length !== 11) throw new Error('unexpected enforcement routine inventory');
    const expected = definitions.map(([, name, args, returns, language, body]) => {
        const parameters = args.trim() ? args.split(',').map((p) => p.trim().split(/\s+/)) : [];
        if (parameters.some((p) => p.length !== 2)) throw new Error('unsupported enforcement signature');
        const result = returns.toLowerCase().replaceAll(/\s/g, '').replaceAll('timestamptz', 'timestampwithtimezone').replaceAll('public.', '');
        const service = !name.startsWith('require_account_closure_');
        return `(${literal(name)},${literal(`public.${name}(${parameters.map((p) => p[1]).join(',')})`)},
          ${literal(createHash('md5').update(body).digest('hex'))},${literal(result)},${literal(language)},${service},
          ARRAY[${parameters.map((p) => literal(p[0])).join(',')}]::text[])`;
    }).join(',');
    const checks = mode === 'before' ? `
      SELECT 'enforcement_routines_absent' AS name, NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected)) AS ok
      UNION ALL SELECT 'journal_binding_absent', NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.account_closure_attempts')
        AND attname IN('drain_attestation_id','drain_generation','drain_binding_digest','drain_context') AND attnum>0 AND NOT attisdropped)
    ` : `
      SELECT 'enforcement_inventory' AS name,(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected))=11 AS ok
      UNION ALL SELECT 'enforcement_routine_identity_acl', NOT EXISTS(SELECT 1 FROM expected e
        LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_language l ON l.oid=p.prolang
        WHERE p.oid IS NULL OR md5(p.prosrc)<>e.digest OR NOT p.prosecdef OR l.lanname<>e.language
          OR replace(regexp_replace(lower(pg_get_function_result(p.oid)),'\\s+','','g'),'public.','')<>e.result_type
          OR coalesce(p.proargnames[1:p.pronargs],ARRAY[]::text[]) IS DISTINCT FROM e.arg_names
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
          OR p.proowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.account_billing_coordination'))
          OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM e.service_exec
          OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
          OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner
            AND (NOT e.service_exec OR a.grantee IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='service_role'))))
      UNION ALL SELECT 'legacy_owner_only', NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN(${CLOSURE_OWNER_ONLY_ROUTINES.map(literal).join(',')})
          AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner))
      UNION ALL SELECT 'journal_columns_private', NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid,
        LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=to_regclass('public.account_closure_attempts') AND acl.grantee<>c.relowner)
    `;
    return `WITH expected(name,signature,digest,result_type,language,service_exec,arg_names) AS(VALUES ${expected}), checks AS(${checks})
      SELECT json_build_object('mode','enforcement-${mode}','checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;
}
export const accountClosureEnforcementInitialQuery = `SELECT json_build_object('mode','enforcement-initial',
  'checks',json_build_object('historical_requests_unbound',NOT EXISTS(SELECT 1 FROM public.account_closure_attempts
    WHERE drain_attestation_id IS NOT NULL OR drain_generation IS NOT NULL OR drain_binding_digest IS NOT NULL OR drain_context IS NOT NULL)),
  'passed',NOT EXISTS(SELECT 1 FROM public.account_closure_attempts
    WHERE drain_attestation_id IS NOT NULL OR drain_generation IS NOT NULL OR drain_binding_digest IS NOT NULL OR drain_context IS NOT NULL))::text;`;
export function assertAccountClosureEnforcement(result, mode) {
    const value = typeof result === 'string' ? JSON.parse(result) : result;
    const required = names[mode];
    if (!required || value?.mode !== `enforcement-${mode}` || value.passed !== true || !value.checks
        || Object.keys(value.checks).length !== required.length || required.some((name) => value.checks[name] !== true)) {
        throw new Error('closure enforcement verification failed');
    }
    return value;
}

export function accountClosureEnforcementStages(mode, { closure, baseline, drain, enforcement }) {
    if (!['before', 'after', 'verify'].includes(mode)) throw new Error('expected before, after or verify');
    const coreMode = mode === 'before' ? 'after' : 'enforced';
    const stages = [
        [accountClosureSchemaQuery(coreMode, closure, enforcement), (r) => assertAccountClosureSchema(r, coreMode)],
        [accountClosureRolloutQuery(coreMode, baseline, enforcement), (r) => assertAccountClosureRollout(r, coreMode)],
        [accountClosureDrainQuery('after', drain), (r) => assertAccountClosureDrain(r, 'after')],
        [accountClosureEnforcementQuery(mode === 'before' ? 'before' : 'after', enforcement),
            (r) => assertAccountClosureEnforcement(r, mode === 'before' ? 'before' : 'after')],
        [accountClosureDisabledQuery, (r) => assertAccountClosureSchema(r, 'disabled')],
    ];
    if (mode === 'after') stages.push([accountClosureEnforcementInitialQuery, (r) => assertAccountClosureEnforcement(r, 'initial')]);
    return stages;
}
