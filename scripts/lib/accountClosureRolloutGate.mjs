import { createHash } from 'node:crypto';

const BASELINE_SHA256 = '76188035d2b050aa4bcd4cf4753fa86d1cc030a12f371f05c9c143378beff030';
const columns = {
    'auth.users': { id: 'uuid', email: 'text-compatible', email_confirmed_at: 'timestamp with time zone' },
    'public.user_profiles': { id: 'uuid', subscription_status: 'text', stripe_customer_id: 'text', stripe_subscription_id: 'text',
        subscription_id: 'text', stripe_cancel_at_period_end: 'boolean', updated_at: 'timestamp with time zone',
        private_sample_limit_seconds: 'integer', private_sample_seconds_used: 'integer', // Historical database columns required by the pinned signup function; not current product limits.
        trial_started_at: 'timestamp with time zone',
        trial_expires_at: 'timestamp with time zone', commercial_trial_granted_at: 'timestamp with time zone' },
    'public.trial_entitlements': { email: 'text', user_id: 'uuid', trial_started_at: 'timestamp with time zone',
        trial_expires_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
};
// Derived from pinned closure SQL on PostgreSQL 17; native proof recomputes each
// catalog digest. PostgreSQL 18 additionally stores NOT NULL as contype=n;
// attnotnull already checks it, so exclude that duplicate catalog representation.
// No OIDs/owner IDs or user contents are included.
const tableDigests = {
    account_billing_coordination: '5a471d2dc0fd1f38b9c765ba48257248',
    account_billing_fences: 'eeac01599bd6120bf76beaba2938a12b',
    account_checkout_operations: 'd434a9f9f8ce0b7747b4ec15a2e3eb34',
    account_closure_attempts: '2010fccaa03e68a4ae79f7e29c999c8b',
    account_closure_billing_permits: 'ef061d1e2bcaf40325d97bed894f7754',
    account_closure_tokens: '07dbce1136efb181e2a17f6284f2927e',
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function accountClosureRolloutQuery(mode, baseline) {
    if (!['before', 'after'].includes(mode)) throw new Error('expected before or after');
    if (createHash('sha256').update(baseline).digest('hex') !== BASELINE_SHA256) throw new Error('baseline source checksum mismatch');
    const body = baseline.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];
    if (!body) throw new Error('baseline function body missing');
    const digest = createHash('md5').update(body).digest('hex');
    const required = Object.entries(columns).flatMap(([table, fields]) => Object.entries(fields)
        .map(([name, type]) => `(${literal(table)},${literal(name)},${literal(type)})`)).join(',');
    const checks = mode === 'before' ? `
      SELECT 'baseline_function' AS name, EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.ensure_trial_profile_for_new_user()')
        AND md5(p.prosrc)='${digest}' AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
        AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) AS ok
      UNION ALL SELECT 'required_columns', NOT EXISTS(SELECT 1 FROM (VALUES ${required}) AS required(relation,name,type)
        LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(required.relation) AND a.attname=required.name AND a.attnum>0 AND NOT a.attisdropped
        WHERE a.attnum IS NULL OR CASE WHEN required.type='text-compatible'
          THEN a.atttypid NOT IN ('text'::regtype,'varchar'::regtype)
          ELSE format_type(a.atttypid,a.atttypmod)<>required.type END)
    ` : `
      SELECT 'exact_table_definitions' AS name, NOT EXISTS(SELECT 1 FROM
        (VALUES ${Object.entries(tableDigests).map(([name, hash]) => `(${literal(name)},'${hash}')`).join(',')}) AS expected(name,digest)
        LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||expected.name)
        WHERE c.oid IS NULL OR md5(jsonb_build_object('columns',
          (SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped), 'constraints',
          (SELECT jsonb_agg(jsonb_build_array(x.conname,pg_get_constraintdef(x.oid)) ORDER BY x.conname)
            FROM pg_constraint x WHERE x.conrelid=c.oid AND x.contype<>'n'))::text)<>expected.digest) AS ok
    `;
    return `WITH checks AS (${checks}) SELECT json_build_object('mode','rollout-${mode}',
      'checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;
}

export function assertAccountClosureRollout(result, mode) {
    const value = typeof result === 'string' ? JSON.parse(result) : result;
    const names = mode === 'before' ? ['baseline_function', 'required_columns'] : mode === 'after' ? ['exact_table_definitions'] : [];
    if (!names.length || value?.mode !== `rollout-${mode}` || value?.passed !== true || !value.checks
        || Object.keys(value.checks).length !== names.length || names.some((name) => value.checks[name] !== true)) throw new Error('closure rollout schema check failed');
    return value;
}
