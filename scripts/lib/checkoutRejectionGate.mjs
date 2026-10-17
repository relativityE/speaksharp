import { createHash } from 'node:crypto';

export const CHECKOUT_REJECTION_SHA256 = '3f53ad3408a35af5cea6baac456e3b34ba433c7bd37d2c238e345df53fc05f6c';
const receiptFingerprint = 'b020c925054980e6331648dea30bf59e';
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
// Logical catalog identity, independent of FK deparser search_path and OIDs.
// NOT NULL is pinned by attnotnull. Exclude duplicate contype=n records, whose
// representation varies by engine, as the existing rollout verifier does.
export const checkoutRejectionTableIdentity = `SELECT md5(jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,k.contype,k.conkey,n.nspname,t.relname,k.confkey,
    k.confupdtype,k.confdeltype,k.confmatchtype,k.condeferrable,k.condeferred,k.convalidated,
    CASE WHEN k.contype='c' THEN pg_get_expr(k.conbin,k.conrelid) ELSE NULL END) ORDER BY k.conname)
    FROM pg_constraint k LEFT JOIN pg_class t ON t.oid=k.confrelid LEFT JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE k.conrelid=c.oid AND k.contype<>'n'))::text) FROM pg_class c WHERE c.oid=to_regclass('public.account_checkout_rejections')`;

const required = { before: ['recovery_absent'],
  after: ['recovery_inventory','recovery_identity_acl','receipt_definition','receipt_privacy','receipt_initial_empty'],
  verify: ['recovery_inventory','recovery_identity_acl','receipt_definition','receipt_privacy'] };

export function checkoutRejectionQuery(mode, source) {
  if (!required[mode] || createHash('sha256').update(source).digest('hex') !== CHECKOUT_REJECTION_SHA256) throw new Error('invalid recovery mode/source');
  const definitions = [...source.matchAll(/CREATE FUNCTION public\.(\w+)\(([\s\S]*?)\)\s*RETURNS ([\s\S]*?)\s+LANGUAGE (\w+)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
  if (definitions.length !== 2) throw new Error('unexpected recovery routine inventory');
  const expected = definitions.map(([, name, args, returns, language, body]) => {
    const parameters = args.split(',').map((p) => p.trim().split(/\s+/));
    if (parameters.some((p) => p.length !== 2)) throw new Error('unsupported recovery signature');
    return `(${literal(name)},${literal(`public.${name}(${parameters.map((p) => p[1]).join(',')})`)},
      ${literal(createHash('md5').update(body).digest('hex'))},${literal(returns.toLowerCase().replaceAll(/\s/g,''))},
      ${literal(language)},ARRAY[${parameters.map((p) => literal(p[0])).join(',')}]::text[])`;
  }).join(',');
  const checks = mode === 'before' ? `SELECT 'recovery_absent' AS name,
    to_regclass('public.account_checkout_rejections') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected)) AS ok` : `
    SELECT 'recovery_inventory' AS name,(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected))=2 AS ok
    UNION ALL SELECT 'recovery_identity_acl',NOT EXISTS(SELECT 1 FROM expected e
      LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid IS NULL OR md5(p.prosrc)<>e.digest OR NOT p.prosecdef OR l.lanname<>e.language OR p.provolatile<>'v'
        OR regexp_replace(lower(pg_get_function_result(p.oid)),'\\s+','','g')<>e.result_type
        OR coalesce(p.proargnames[1:p.pronargs],ARRAY[]::text[]) IS DISTINCT FROM e.arg_names
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR p.proowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.account_checkout_operations'))
        OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE')
        OR has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee<>p.proowner AND a.grantee IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='service_role')))
    UNION ALL SELECT 'receipt_definition',coalesce((${checkoutRejectionTableIdentity}),'')=${literal(receiptFingerprint)}
    UNION ALL SELECT 'receipt_privacy',EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.account_checkout_rejections')
      AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
      AND c.relowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.account_checkout_operations'))
      AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
      AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
      AND NOT EXISTS(SELECT 1 FROM pg_attribute a,LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=c.oid AND acl.grantee<>c.relowner))
    ${mode === 'after' ? "UNION ALL SELECT 'receipt_initial_empty',NOT EXISTS(SELECT 1 FROM public.account_checkout_rejections)" : ''}`;
  return `WITH expected(name,signature,digest,result_type,language,arg_names) AS(VALUES ${expected}), checks AS(${checks})
    SELECT json_build_object('mode','checkout-rejection-${mode}','checks',json_object_agg(name,ok),'passed',bool_and(ok))::text FROM checks;`;
}

export function assertCheckoutRejection(result, mode) {
  const value = typeof result === 'string' ? JSON.parse(result) : result;
  const names = required[mode];
  if (!names || value?.mode !== `checkout-rejection-${mode}` || value.passed !== true || !value.checks
    || Object.keys(value.checks).length !== names.length || names.some((name) => value.checks[name] !== true)) throw new Error('checkout recovery verification failed');
  return value;
}
