// Read-only catalog attestation for the six reviewed T2 migrations. This never
// calls an application RPC, activates deletion, or treats migration history as
// proof that the deployed implementation matches its reviewed source.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';
import { C1_VERSIONS, c1Contract, c1CatalogQuery, functionDefinitions } from './c1MigrationPostflight.mjs';

export const T2_VERSIONS = Object.freeze([
  '20261018090000', '20261018170000', '20261019010000',
  '20261019055102', '20261019202856', '20261020230653',
]);
const literal = value => `'${value.replaceAll("'", "''")}'`;

export const T2_INVENTORY = Object.freeze({
"functions": [
    "_account_completion_lock_v1",
    "_account_completion_receipt_v1",
    "_account_completion_status_owner_v1",
    "_account_save_delete_guard_v1",
    "_account_save_lease_obligation_v1",
    "_account_save_session_obligation_v1",
    "_finish_account_closure_legacy_v1",
    "_ss_acquire_recording_lease_1476",
    "_ss_recording_admission_1643",
    "account_closure_pending_status",
    "acknowledge_account_completion_status_v1",
    "acquire_recording_lease",
    "apply_account_checkout_snapshot",
    "begin_account_checkout",
    "begin_account_closure_pending",
    "begin_account_coaching_v1",
    "begin_account_completion_stage_v1",
    "bind_account_closure_recovery_authority",
    "claim_account_closure_token",
    "claim_account_closure_token_with_drain",
    "claim_account_pending_completion_v1",
    "complete_account_pending_completion_v1",
    "confirm_account_checkout_reuse",
    "ensure_trial_profile_for_new_user",
    "finish_account_closure_attempt",
    "finish_account_coaching_failure_v1",
    "finish_account_completion_stage_v1",
    "get_analytics_summary",
    "guard_account_closure_billing",
    "guard_unsettled_account_coaching_delete_v1",
    "heartbeat_session",
    "inspect_account_checkout",
    "inspect_account_closure_authority",
    "inspect_account_closure_checkouts",
    "inspect_account_closure_drain_generation",
    "inspect_account_closure_pending",
    "inspect_account_pending_completion_v1",
    "inspect_rejected_account_checkout",
    "invalidate_account_closure_drain_attestations",
    "issue_account_closure_pending_token",
    "issue_account_closure_token",
    "issue_account_closure_token_with_drain",
    "issue_account_completion_status_v1",
    "list_account_closure_storage",
    "persist_account_coaching_v1",
    "persist_ai_suggestion_with_authority_v1",
    "preserve_account_trial_email",
    "read_account_completion_status_v1",
    "read_ai_suggestion_authority_v1",
    "reconcile_account_checkout_expiry",
    "reconcile_account_closure_checkout_with_drain",
    "reconcile_expired_account_checkout",
    "reconcile_rejected_account_checkout",
    "record_account_checkout",
    "record_account_closure_auth_state",
    "record_account_closure_auth_state_with_drain",
    "record_account_closure_drain_attestation",
    "record_ai_suggestion_cache_read_v1",
    "require_account_closure_drain",
    "require_account_closure_request_authority",
    "revoke_account_closure_token",
    "settle_account_checkout",
    "settle_account_closure_billing",
    "settle_account_closure_billing_with_drain",
    "verify_account_closure_residue",
    "verify_account_closure_residue_with_drain"
  ],
  "tables": [
    "account_billing_coordination",
    "account_billing_fences",
    "account_checkout_operations",
    "account_checkout_rejections",
    "account_checkout_snapshot_permits",
    "account_closure_attempts",
    "account_closure_attestation_state",
    "account_closure_billing_permits",
    "account_closure_drain_attestations",
    "account_closure_tokens",
    "account_coaching_operations",
    "account_completion_configuration",
    "account_completion_coverage",
    "account_completion_executions",
    "account_completion_stages",
    "account_completion_status_capabilities",
    "account_save_obligations",
    "ai_suggestion_authority_receipts"
  ],
  "triggers": [
    "account_closure_billing_guard",
    "account_save_delete_guard",
    "guard_unsettled_account_coaching_delete",
    "ss_recording_admission_1643",
    "zz_account_save_obligation",
    "zz_account_save_session_obligation"
  ]
});

export function assertT2Sources(sources) {
  for (const version of T2_VERSIONS) {
    const entry = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
    if (!entry || typeof sources[version] !== 'string' ||
      createHash('sha256').update(sources[version]).digest('hex') !== entry.sha256) {
      throw new Error(`T2 migration source mismatch: ${version}`);
    }
  }
}

// Stable logical identity: no OIDs, role names of the installer, customer rows,
// timestamps, token hashes or other capability values enter the result.
export function t2CatalogQuery(inventory) {
  const names = key => inventory[key].map(literal).join(',');
  return `WITH objects AS (
    SELECT 'function:'||n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS name,
      md5(jsonb_build_object('body',p.prosrc,'result',pg_get_function_result(p.oid),
        'args',p.proargnames,'defaults',pg_get_expr(p.proargdefaults,0),'language',l.lanname,
        'security_definer',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
        'parallel',p.proparallel,'leakproof',p.proleakproof,'kind',p.prokind,'config',p.proconfig,
        'owner_matches',p.proowner=(SELECT relowner FROM pg_class WHERE oid='public.account_closure_attempts'::regclass),
        'acl',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=p.proowner THEN 'OWNER'
          WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
          ORDER BY CASE WHEN a.grantee=p.proowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
          FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))::text) AS digest
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.proname IN (${names('functions')})
    UNION ALL
    SELECT 'table:public.'||c.relname,md5(jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
      'owner_matches',c.relowner=(SELECT relowner FROM pg_class WHERE oid='public.account_closure_attempts'::regclass),
      'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
        a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
        (SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=c.relowner THEN 'OWNER' WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable) ORDER BY x.grantee,x.privilege_type)
          FROM aclexplode(a.attacl) x)) ORDER BY a.attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      -- Key columns by ORDERED NAME on both sides, never physical attnums: the same logical reference must hash the
      -- same whatever ordinal the column has (production auth.users stores id at a different position than fixtures).
      'constraints',(SELECT jsonb_agg(jsonb_build_array(k.conname,k.contype,
        (SELECT jsonb_agg(ka.attname ORDER BY kk.ord) FROM unnest(k.conkey) WITH ORDINALITY kk(attnum,ord)
          JOIN pg_attribute ka ON ka.attrelid=k.conrelid AND ka.attnum=kk.attnum),
        n.nspname,t.relname,
        (SELECT jsonb_agg(fa.attname ORDER BY fk.ord) FROM unnest(k.confkey) WITH ORDINALITY fk(attnum,ord)
          JOIN pg_attribute fa ON fa.attrelid=k.confrelid AND fa.attnum=fk.attnum),
        k.confupdtype,k.confdeltype,k.confmatchtype,k.condeferrable,k.condeferred,k.convalidated,
        CASE WHEN k.contype='c' THEN pg_get_expr(k.conbin,k.conrelid) ELSE NULL END) ORDER BY k.conname)
        FROM pg_constraint k LEFT JOIN pg_class t ON t.oid=k.confrelid LEFT JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE k.conrelid=c.oid AND k.contype<>'n'),
      'indexes',(SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),
      'triggers',(SELECT jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred) ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
      'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),
        (SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(p.polroles) r)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
      'acl',(SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
        ORDER BY CASE WHEN a.grantee=c.relowner THEN 'OWNER' WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
        FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a))::text)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${names('tables')})
    UNION ALL
    SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
      md5(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred)::text)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND t.tgname IN (${names('triggers')})
  ) SELECT coalesce(json_object_agg(name,digest),'{}'::json)::text FROM objects;`;
}

export function assertT2Catalog(actual, expected) {
  const value = typeof actual === 'string' ? JSON.parse(actual) : actual;
  if (!value || Array.isArray(value) || typeof value !== 'object' || !expected || Object.keys(expected).length === 0) {
    throw new Error('T2 catalog evidence absent');
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(value)]);
  for (const key of keys) {
    if (!/^[a-f0-9]{32}$/.test(value[key] || '') || value[key] !== expected[key]) {
      throw new Error(`T2 catalog mismatch: ${key}`);
    }
  }
  return { passed: true, objects: keys.size };
}

// Immutable logical catalog identities, recomputed from the checked-in SQL in
// the bounded fixture tests. Native126 must independently confirm these on the
// receiving source before operational use. Stage0 is the pre-T2 schema; stageN
// includes all earlier targets. A final verify uses stage6, never the obsolete
// pending-stage finish_account_closure_attempt after completion replaces it.
const T2_CATALOG_DELTAS = Object.freeze([
  {
    "function:public.reconcile_account_checkout_expiry(uuid, uuid, text)": "28ac0c3352be15f02d50948e91eaedfe",
    "function:public.record_account_checkout(uuid, uuid, text)": "a284e61c605610c89a964984d2c74b87",
    "function:public.heartbeat_session(uuid, integer)": "f876d8d1b85914eddd3ca6e4b9c12068",
    "function:public.inspect_account_checkout(uuid)": "74ef5865f0555c6e5d57575d2eff1e42",
    "function:public.guard_account_closure_billing()": "56f236797ebfee91836afa889e3bf43f",
    "function:public.ensure_trial_profile_for_new_user()": "9d96f1ff6e4949e2ecde48a9db3b97f3",
    "function:public.revoke_account_closure_token(uuid, text)": "f930d51462fdd6f40cd378e99ebb8e15",
    "function:public.begin_account_checkout(uuid)": "099d7a487885f68781907b10257d73c0",
    "function:public.confirm_account_checkout_reuse(uuid, uuid, text)": "9c450ec42ac2a7b47c9574e3392ce5a1",
    "function:public.settle_account_checkout(uuid, text, text, text, uuid)": "942a886dd9ab296d2f48f2a59222df2f",
    "function:public.inspect_account_closure_checkouts(uuid, text)": "e55b317243b4407cd13558d3b6e0c80c",
    "function:public.reconcile_expired_account_checkout(uuid, text, uuid, text)": "166241269098fb4f9e36b31c12b1b2ce",
    "function:public.issue_account_closure_token(uuid, text)": "0eaeb329700dcebff3b5104c5c3fd031",
    "function:public.claim_account_closure_token(uuid, text)": "f3cda314d80182d83b28dec2e17633fb",
    "function:public.finish_account_closure_attempt(uuid, uuid)": "205b1136a73b76180aac722e74264c8c",
    "function:public.record_account_closure_auth_state(uuid, uuid, text)": "ed1bbf8716b36913049666585af653f4",
    "function:public.preserve_account_trial_email(uuid)": "6157abc951040b79ae07733cde23323c",
    "function:public.settle_account_closure_billing(uuid, uuid, text, jsonb)": "9516d3f32b3e6e71693df2442f7c38c1",
    "function:public.verify_account_closure_residue(uuid, text)": "26bafb87355a7e7f8b783ad32dcaa1b8",
    "function:public.list_account_closure_storage(uuid)": "88b0437de30097464014386440db8935",
    "function:public.invalidate_account_closure_drain_attestations(bigint, text, text)": "1610e1ca9b531bb199fe4a0ba7606741",
    "function:public.record_account_closure_drain_attestation(uuid, bigint, jsonb, jsonb)": "9ec7e19cfeae20ce3f7bf74961c6c748",
    "function:public.require_account_closure_drain(uuid, bigint, text, jsonb)": "5dd12df14c782e156e3db5d8b4579eae",
    "function:public.require_account_closure_request_authority(uuid, uuid, uuid, bigint, text, jsonb)": "d68855f46ee71fb99fc56ffd273ced4e",
    "function:public.claim_account_closure_token_with_drain(uuid, text, uuid, bigint, text, jsonb)": "8732142e525a4390d038211ab30014c2",
    "function:public.inspect_account_closure_drain_generation()": "07fc034e863f291a5fa9dc3b446f8bf9",
    "function:public.issue_account_closure_token_with_drain(uuid, text, uuid, bigint, text, jsonb)": "64aec064a8e1dded488d1225544f0cce",
    "function:public.reconcile_account_closure_checkout_with_drain(uuid, text, uuid, text, text, text, uuid, bigint, text, jsonb)": "8c218faadd7e355630b22a1885c68cf4",
    "function:public.inspect_account_closure_authority(uuid, uuid, uuid, bigint, text, jsonb)": "b5b9426ccdeb7cefae75c34c2175585e",
    "function:public.bind_account_closure_recovery_authority(uuid, uuid, uuid, bigint, text, jsonb)": "00c8c194438686bbd14b3e750de8cca5",
    "function:public.record_account_closure_auth_state_with_drain(uuid, uuid, text, uuid, bigint, text, jsonb)": "728805c5925c0e0852cd832d69f20cd6",
    "function:public.settle_account_closure_billing_with_drain(uuid, uuid, text, jsonb, uuid, bigint, text, jsonb)": "7f7fe92423b247b641044f0319ec2f71",
    "function:public.verify_account_closure_residue_with_drain(uuid, uuid, uuid, bigint, text, jsonb)": "68e9c49ded181fe445a4c759244e251b",
    "function:public.reconcile_rejected_account_checkout(uuid, uuid, text, text, text)": "e4d7b8662639a9e4356977586c11bf28",
    "function:public.inspect_rejected_account_checkout(uuid, uuid)": "d0b5221fc31e4736f5d54ca2a3580864",
    "function:public.read_ai_suggestion_authority_v1(uuid[])": "5609d13dcaf8c44b524a3f147694bdf8",
    "function:public.get_analytics_summary(uuid)": "bb15cab65201762eb30c385e3013d879",
    "function:public.persist_ai_suggestion_with_authority_v1(uuid, uuid, jsonb, text, text, text, date, integer, integer)": "b27043ba146090b17f08046f4d7a8287",
    "function:public.record_ai_suggestion_cache_read_v1(uuid, uuid)": "5fca643c381f527c86b768485a00c997",
    "function:public.acquire_recording_lease(uuid, text, boolean)": "0cb6965169d3e819f101dfb4f9954942",
    "table:public.account_closure_tokens": "bfdd168a1d52e50be94281fb6b711579",
    "table:public.account_closure_attempts": "7969e4558754e8e60207fd1d969381e4",
    "table:public.account_closure_billing_permits": "5fea88087fc5573c159020092cf92fe1",
    "table:public.account_billing_fences": "700bdb1a54b786b57f2b64cad4d24dbb",
    "table:public.account_checkout_operations": "da8ec4a6dac3b5bb952bcc9ae19f0164",
    "table:public.account_billing_coordination": "7a16ec8a22aabe47653a435120b422da",
    "table:public.account_checkout_rejections": "48d9ce6680a25d852d831dc3c083f5c1",
    "table:public.account_closure_attestation_state": "63c485b47356e35836906773b898386e",
    "table:public.account_closure_drain_attestations": "dedb393d92ce9f268d69a1e9632f5d61",
    "table:public.ai_suggestion_authority_receipts": "e594e3da4ed4bd3cb5c8bfb4b8c88c74",
    "trigger:public.user_profiles.account_closure_billing_guard": "e025d20da3a872a23a7160a4c6373020"
  },
  {
    "function:public.get_analytics_summary(uuid)": "6239e46a4fe6ed7d91e18f1469a985d6"
  },
  {
    "function:public.guard_account_closure_billing()": "15cc9135e6196ea05be343e8af1c2359",
    "function:public.settle_account_checkout(uuid, text, text, text, uuid)": "63298763ad1fabd0fe047f1811c7afbc",
    "function:public.finish_account_closure_attempt(uuid, uuid)": "c46bab063c224dec33207c31e20915ff",
    "function:public.reconcile_rejected_account_checkout(uuid, uuid, text, text, text)": "4579287ba667acf6e68a546f646c463f",
    "function:public.apply_account_checkout_snapshot(uuid, uuid, text, text, text, text, text, boolean, boolean, bigint, bigint)": "57d5411be34f1493447d4d3ca953dc04",
    "function:public.account_closure_pending_status()": "fb6d1fb9899a9978eca59f169c3cfd4e",
    "function:public.issue_account_closure_pending_token(uuid, text)": "bf91f23a8d54c93a7c04e94af69b42b8",
    "function:public.inspect_account_closure_pending(uuid)": "d67254996971abb7ffd202a187d0ac25",
    "function:public.reconcile_account_checkout_expiry(uuid, uuid, text)": "afb30d394e397444b9596259a45e0754",
    "function:public.begin_account_closure_pending(uuid, text, boolean)": "36c64175b123523b29f396118c6953bd",
    "table:public.account_closure_attempts": "66361c1bd3895ec778bad8ea37cca8c6",
    "table:public.account_billing_fences": "3cf9fa34a4e6d68223c478cb91444800",
    "table:public.account_checkout_operations": "c28318eb7ccf561720c67b1e01e8714b",
    "table:public.account_checkout_snapshot_permits": "65e6b088fc4da28869cc88361fdb7cd8"
  },
  {
    "function:public.heartbeat_session(uuid, integer)": "c3f851ad796d006fe3d8002ecb79e896"
  },
  {
    "function:public._ss_acquire_recording_lease_1476(uuid, text, boolean)": "1935ac05f070f869861261c7526d6ddf",
    "function:public.acquire_recording_lease(uuid, text, boolean)": "168027bea87783360840e880ac91a09a",
    "function:public._ss_recording_admission_1643()": "86fab61c94c8289e32244854a66e3218",
    "trigger:public.active_recording_lease.ss_recording_admission_1643": "5049ce715343f221332180f753e41f50"
  },
  {
    "function:public.guard_unsettled_account_coaching_delete_v1()": "d51ed4445c5a67e5f10fb689f09b847f",
    "function:public.begin_account_coaching_v1(uuid, uuid, uuid)": "edcfc63cffbcbf73c4932749e0bcd6c8",
    "function:public.finish_account_coaching_failure_v1(uuid, uuid, uuid, text)": "80bfbd8b899a24865fc39af34af386e8",
    "function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)": "c9b2e77bade20b68263d529c99ea3711",
    "table:public.account_coaching_operations": "065ce7b1d5e5609fe233497bd28482cc",
    "trigger:public.account_coaching_operations.guard_unsettled_account_coaching_delete": "6910ba024693398b37f34ff137ce7ea2"
  },
  {
    "function:public._account_completion_receipt_v1(uuid, uuid, uuid, text, text, text)": "a21b5a51153619fcaaa599c703a9d954",
    "function:public._finish_account_closure_legacy_v1(uuid, uuid)": "e7a7a4d70cf51ccb349a4f7fcfeeb205",
    "function:public._account_save_lease_obligation_v1()": "063c8a132c6a1c6a83cfe8e04de57de0",
    "function:public._account_save_session_obligation_v1()": "3c7f65406f5112d79d7a9024fe732532",
    "function:public._account_save_delete_guard_v1()": "49d93c186e20f9f5574890af8142c428",
    "function:public._account_completion_lock_v1(uuid, uuid, uuid, text)": "589b7041cf7dd2443f573a09f654ccea",
    "function:public.inspect_account_pending_completion_v1(uuid, uuid, uuid, text)": "1f2386a05ece1485943e251a9086b168",
    "function:public.claim_account_pending_completion_v1(uuid, uuid, text)": "73c6f9fdb5feae6f9b00ee3d4d6f2ea8",
    "function:public.begin_account_completion_stage_v1(uuid, uuid, uuid, text, text)": "530217b5795eac74ba41275e897a8086",
    "function:public.finish_account_completion_stage_v1(uuid, uuid, uuid, text, text, text)": "8aa6e7ac4456fe4b7445de8f5f8da897",
    "function:public.complete_account_pending_completion_v1(uuid, uuid, uuid, text)": "41762ad97c0e815324ed82eef8a178e9",
    "function:public.finish_account_closure_attempt(uuid, uuid)": "9b26b3e3972583c63a30b9e8874f3fbb",
    "function:public._account_completion_status_owner_v1(uuid, uuid, text)": "07e37fbce9d67eb21e1349106a82e7b8",
    "function:public.read_account_completion_status_v1(uuid, text, text)": "20e241ad3b8d4fa2d3a4c8a244865c8e",
    "function:public.issue_account_completion_status_v1(uuid, uuid, text, text)": "0d2525d2fb624e8d0fae6adc136bd674",
    "function:public.acknowledge_account_completion_status_v1(uuid, uuid, text, text)": "bc14b1410675fcede485c03a3627c2b3",
    "table:public.account_completion_configuration": "139e90a6afcd6964cecfdc24d0c29892",
    "table:public.account_completion_coverage": "eec77da40c7255910d948711e93ffd56",
    "table:public.account_save_obligations": "a2a5f712bb948f25cda83d0be4fcada9",
    "table:public.account_completion_executions": "072e94be84ba323a1b5477950cce8b12",
    "table:public.account_completion_stages": "c46341deacb4ae03e044c83f4b128abf",
    "table:public.account_completion_status_capabilities": "a3409a44227495343149739d49856c83",
    "trigger:auth.users.account_save_delete_guard": "bdca1f67ec23b0d8c9c7e62ec303a023",
    "trigger:public.sessions.zz_account_save_session_obligation": "4412df75c096a907afcb0327544c0fb2",
    "trigger:public.active_recording_lease.zz_account_save_obligation": "c026b47e3c8d91ab48cb5bf5619b49f2"
  }
]);
export const T2_CATALOG_STATES = Object.freeze(T2_CATALOG_DELTAS.reduce((states, delta) => {
  states.push(Object.freeze({ ...(states.at(-1) || {}), ...delta }));
  return states;
}, []));

// Separate forward release identities derived by executing the immutable C1 SQL.
// Historical stage0..6 above is never rewritten. Native replay must confirm these.
const T2_C1_RELEASE_DELTAS = Object.freeze([
  {
    "function:public.persist_ai_suggestion_with_authority_v1(uuid, uuid, jsonb, text, text, text, date, integer, integer)": "6ffe645c11f78b6c791b75a25599b36e",
    "function:public.record_ai_suggestion_cache_read_v1(uuid, uuid)": "b34511cc78472f292fc6551e4ef68021",
    "function:public.guard_unsettled_account_coaching_delete_v1()": "113e17795bee25f7f45024a43f0079c4",
    "function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)": "cb462f9515c1e98dfa4783c43583cb4f",
    "function:public.claim_account_pending_completion_v1(uuid, uuid, text)": "c56518f7af715dbcb77de3dbf585264b",
    "function:public.read_account_completion_status_v1(uuid, text, text)": "89284690dc031017e44bd06aabab8591",
    "function:public.fence_account_coaching_unknown_v1(uuid, uuid, uuid, uuid, text, text)": "274640d3e6b75cdb5b0be3af73a8ef45",
    "function:public.guard_account_coaching_ai_suggestions_write_v1()": "ee00356a3ebc8745fe83b84713656611",
    "table:public.account_coaching_fences": "dc85ef37535a4a5ee97dc01a3cd0afc3",
    "table:public.account_coaching_operations": "8fe20db2fff83ec60ac618ddcd627610",
    "table:public.ai_suggestion_authority_receipts": "8a930630dfb9928c7f88722432ffe3b7",
    "trigger:public.sessions.a_guard_account_coaching_ai_suggestions_update": "29e4d8a5d12c82c53a8868742c910253",
    "trigger:public.sessions.a_guard_account_coaching_ai_suggestions_insert": "9c7612f6b52ae2cf7c54a409783acff7"
  },
  {
    "function:public.record_progress_evaluation(uuid)": "05303c002e98a6d7e74653464c3374fa",
    "function:public.converge_transcript_retention(uuid)": "5eaaa68a4f4749d51f358e76b29ada1b",
    "function:public.spe_converge_retention()": "323ffda94b366fee86ce443d3925dd02",
    "function:public._ss_retention_expired_derived_guard()": "d8031a066da2c6b99f9e8593f77ae3b9",
    "function:public._ss_retention_recovery_write_guard()": "59d52c569c611786333e0b54b80089e3",
    "function:public.complete_session_v2(uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb, text)": "d4d5fa9ee94fddf6634acea7acf0f3ad",
    "function:public.sessions_set_transcript_state()": "9f8558a346fc95825d9e6d2fbcef8c1f",
    "function:public.arm_transcript_retention_for_save(uuid, uuid)": "dd34ab1692f7f65b92c8056357e58d48",
    "function:public.expire_transcripts_newest_one(uuid, integer)": "47abf83648384ae575060bc2c78369dd",
    "function:public.create_session_and_update_usage(jsonb, text, uuid, text, text, text)": "1b328206df8c69c34be7fe5f406ed3bd",
    "function:public._ss_retention_content_cohort(sessions)": "e04819fcd39355e7ec430a44ef002d76",
    "function:public.retention_content_free_compatible()": "8409c2c6c4154d9312cab6cdc534e571",
    "function:public._ss_retention_content_statement_lock()": "95fbbbfc161ca329413e13b3af4da520",
    "function:public._ss_retention_content_row_guard()": "44b51b9dc40454218e9652d605f14181",
    "table:public.transcript_retention_expiry_grants": "a8ca33f1b581b779e43e09b97da96745",
    "table:public.session_progress_content_evidence": "fda946aa0841b143d02a49c135fbaa7a",
    "table:public.transcript_retention_replacement_context": "897b8ae45db7fdf23f463139671193f5",
    "table:public.transcript_retention_function_pins": "a115db920f2d9045ee05a8e8b596da9e",
    "trigger:public.sessions.aa_retention_expired_derived_guard": "b17f6160ab9b40fd0d13e61bcdb34110",
    "trigger:public.sessions.aa_retention_content_row_guard": "941ddb6e392c02d3604881e2f0f2b4c5",
    "trigger:public.sessions.aa_retention_content_statement_lock": "0a4c5feeee5d71c44df4cf549dc70088",
    "trigger:public.transcript_retention_tombstones.aa_retention_recovery_write_guard": "dc3637c01a38f2262ab1028e5245b99c"
  }
].map(Object.freeze));

export function t2ExpectedCatalog(mode, version) {
  if (mode === 'verify' && version === 'release') return T2_CATALOG_STATES.at(-1);
  const index = T2_VERSIONS.indexOf(version);
  if (index < 0 || !['before', 'after'].includes(mode)) throw new Error('invalid T2 target/mode');
  return T2_CATALOG_STATES[index + (mode === 'after' ? 1 : 0)];
}

// Deliberately emits only booleans; no drain/capability/token values are read
// back. Enabling either authority needs its own reviewed operational procedure.
export function t2DisabledQuery(completionPresent) {
  return `SELECT json_build_object('billing_disabled',
    (SELECT count(*)=1 AND bool_and(singleton AND NOT checkout_workers_drained AND evidence_reference IS NULL)
      FROM public.account_billing_coordination)
    ${completionPresent ? ", 'completion_disabled',(SELECT count(*)=1 AND bool_and(singleton AND NOT enabled AND scope_digest IS NULL) FROM public.account_completion_configuration)" : ''})::text;`;
}

export function assertT2Disabled(actual, completionPresent) {
  const value = typeof actual === 'string' ? JSON.parse(actual) : actual;
  const keys = completionPresent ? ['billing_disabled', 'completion_disabled'] : ['billing_disabled'];
  if (!value || Object.keys(value).length !== keys.length || keys.some(key => value[key] !== true)) {
    throw new Error('T2 inactive authority prerequisite failed');
  }
  return { passed: true, checks: keys };
}

export function t2LedgerQuery(mode, version) {
  t2ExpectedCatalog(mode, version);
  const count = version === 'release' ? T2_VERSIONS.length
    : T2_VERSIONS.indexOf(version) + (mode === 'after' ? 1 : 0);
  const required = T2_VERSIONS.slice(0, count);
  const absent = T2_VERSIONS.slice(count);
  return `SELECT ((SELECT count(*) FROM supabase_migrations.schema_migrations
    WHERE version IN (${required.length ? required.map(literal).join(',') : "''"}))=${required.length}
    AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version IN (${absent.length ? absent.map(literal).join(',') : "''"})))::text;`;
}

export function t2AdmissionQuery(enforced) {
  return `SELECT (EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.active_recording_lease') AND c.relrowsecurity)
    AND (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.active_recording_lease')
      AND attname IN ('user_id','lease_id') AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)=2
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a,LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid=to_regclass('public.active_recording_lease') AND acl.privilege_type IN ('INSERT','UPDATE','REFERENCES')
        AND acl.grantee<>(SELECT relowner FROM pg_class WHERE oid=a.attrelid)
        AND acl.grantee IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='service_role'))
    ${enforced ? `AND has_table_privilege('authenticated','public.active_recording_lease','SELECT')
      AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) roles(name),
        (VALUES('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) privileges(name)
        WHERE has_table_privilege(roles.name,'public.active_recording_lease',privileges.name))` : ''})::text;`;
}

// The first read selects a candidate only. The executable repeats this ledger in
// the SAME read-only snapshot as the actual catalog and rejects any drift.
export function t2ReleaseLedgerQuery() {
  return `SELECT coalesce(json_agg(version ORDER BY version),'[]'::json)::text
    FROM supabase_migrations.schema_migrations WHERE version >= '${T2_VERSIONS[0]}';`;
}

export function t2ReleaseContract(root, installed) {
  const ledger = typeof installed === 'string' ? JSON.parse(installed) : installed;
  const versions = [...T2_VERSIONS, ...C1_VERSIONS];
  if (!Array.isArray(ledger) || ![6, 7, 8].includes(ledger.length)
    || ledger.some((version, index) => version !== versions[index])) {
    throw new Error('T2 release ledger unknown, mixed or incomplete');
  }
  const stage = ledger.length - T2_VERSIONS.length;
  // Bind all eight local sources, including absent successors. Installed state
  // is proved independently by catalogs; the local source is not installation.
  const sources = {};
  const pins = versions.map(version => {
    const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
    if (!pin) throw new Error('T2 release source pin absent');
    const file = join(root, 'backend/supabase/migrations', pin.file);
    if (!lstatSync(file).isFile() || realpathSync(file) !== file) throw new Error('T2 release source alias');
    sources[version] = readFileSync(file, 'utf8');
    if (createHash('sha256').update(sources[version]).digest('hex') !== pin.sha256) {
      throw new Error(`T2 release source mismatch: ${version}`);
    }
    return { version, sha256: pin.sha256 };
  });
  const c1Sources = C1_VERSIONS.slice(0, stage).map(version => sources[version]);
  const inventory = {
    functions: [...new Set([...T2_INVENTORY.functions, ...c1Sources.flatMap(source =>
      functionDefinitions(source).map(fn => fn.signature.split('(')[0].slice(7)))])].sort(),
    tables: [...new Set([...T2_INVENTORY.tables, ...c1Sources.flatMap(source =>
      [...source.matchAll(/CREATE TABLE public\.([a-z_0-9]+)/g)].map(match => match[1])),
      ...(stage === 2 ? ['transcript_retention_expiry_grants'] : [])])].sort(),
    triggers: [...new Set([...T2_INVENTORY.triggers, ...c1Sources.flatMap(source =>
      [...source.matchAll(/CREATE TRIGGER ([a-z_0-9]+)/g)].map(match => match[1]))])].sort(),
  };
  const expected = Object.assign({}, T2_CATALOG_STATES.at(-1), ...T2_C1_RELEASE_DELTAS.slice(0, stage));
  // The independent source-derived C1 checker also refuses future/partial
  // objects and old body/ACL/trigger shapes, even before their ledger entry.
  const c1 = stage === 2 ? c1Contract(root, 'after', C1_VERSIONS[1])
    : c1Contract(root, 'before', C1_VERSIONS[stage]);
  return { profile: `post-${126 + stage}`, stage, ledger: [...ledger], pins, inventory, expected, c1 };
}

export function assertT2ReleaseSnapshot(contract, rows) {
  if (!Array.isArray(rows) || rows.length !== 5) throw new Error('incomplete T2 release evidence');
  const ledger = JSON.parse(rows[0]);
  if (JSON.stringify(ledger) !== JSON.stringify(contract.ledger)) throw new Error('T2 release ledger changed');
  const catalog = assertT2Catalog(rows[1], contract.expected);
  const disabled = assertT2Disabled(rows[2], true);
  if (rows[3] !== 'true') throw new Error('T2 recording admission prerequisite failed');
  const c1 = JSON.parse(rows[4]);
  const names = c1CatalogQuery(contract.c1).names.sort();
  if (!c1 || !Array.isArray(c1.checks)
    || JSON.stringify(c1.checks.map(row => row.name).sort()) !== JSON.stringify(names)) {
    throw new Error('T2 release C1 evidence incomplete');
  }
  for (const check of c1.checks) if (check.ok !== true) throw new Error(`T2 release C1 mismatch: ${check.name}`);
  // Verification reads the existing retention policy; it neither enables it nor
  // pretends to have a before-apply receipt. Completion/billing remain disabled.
  if (!Array.isArray(c1.activation) || c1.activation.length !== 1
    || c1.activation[0].policy_version !== 'newest_one_v1'
    || !Object.hasOwn(c1.activation[0], 'activated_at')
    || (c1.activation[0].activated_at !== null && (typeof c1.activation[0].activated_at !== 'string'
      || !Number.isFinite(Date.parse(c1.activation[0].activated_at))))) {
    throw new Error('T2 release retention state unavailable');
  }
  return { profile: contract.profile, catalog, disabled, c1Checks: names.length, passed: true };
}

export function t2ReleaseSnapshotQuery(contract) {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=public,pg_temp;
${t2ReleaseLedgerQuery()}
${t2CatalogQuery(contract.inventory)}
${t2DisabledQuery(true)}
${t2AdmissionQuery(true)}
${c1CatalogQuery(contract.c1).sql}
COMMIT;`;
}
