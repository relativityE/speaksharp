// @vitest-environment node
// Bounded PostgreSQL-WASM catalog controls, not native126 or production proof.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertT2Sources, assertT2Catalog, t2CatalogQuery, T2_VERSIONS, T2_INVENTORY,
  t2ExpectedCatalog, t2DisabledQuery, assertT2Disabled, t2AdmissionQuery, t2LedgerQuery,
  t2ReleaseLedgerQuery, t2ReleaseContract, t2ReleaseSnapshotQuery, assertT2ReleaseSnapshot,
  t2KnownAbsentQuery } from '../../scripts/lib/t2MigrationPostflight.mjs';
import { EXACT_MIGRATION_ALLOWLIST } from '../../scripts/lib/exactMigrationGate.mjs';

const read = name => readFileSync(name, 'utf8');
const source = name => read('backend/supabase/migrations/' + name);
const sources = Object.fromEntries(T2_VERSIONS.map(version => [version,
  source(EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version).file)]));
const c1Versions = ['20261024083000', '20261025021046'];

// BEGIN BOUNDED FIXTURE. Platform tables/usage are the existing declared fixture;
// application table/function definitions below are executed from real source.
async function fixture({ historicalTableDefaults = true, platformFunctionDefaults = true } = {}) {
  const db = new PGlite();
  const bootstrap = read('tests/db/account-closure-tokens.integration.test.ts')
    .match(/await db\.exec\(`\n([\s\S]*?)`\);/);
  if (!bootstrap) throw new Error('scoped account fixture absent');
  await db.exec(bootstrap[1]);
  await db.exec(`CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    SET ROLE closure_owner;`);
  // Native replay includes this earlier default under its object-creating role.
  // Apply only the exact historical TABLE default: existing bootstrap tables and
  // sequence/function defaults are outside this fixture-history correction.
  if (historicalTableDefaults) {
    const grants = source('20251219150000_fix_service_role_permissions.sql')
      .match(/^ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;$/gm);
    if (grants?.length !== 1) throw new Error('exact historical table-default grant absent or ambiguous');
    await db.exec(grants[0]);
  }
  // The immutable Supabase17.6.1.155 replay initializes these function defaults
  // for its creating role. Field-by-field native/source comparison proved this
  // inherited ACL difference in two CREATE OR REPLACE retention functions.
  // This is fixture setup, never a migration or permission-policy correction.
  if (platformFunctionDefaults) await db.exec(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role');
  for (const name of ['20260812041600_trial_commercial_grant_on_conflict_1294.sql',
    '20260812002000_webhook_lifecycle_completeness_1282.sql']) await db.exec(source(name));
  const canonical = source('20260812041500_flawless_launch_runtime_convergence_1290.sql');
  await db.exec(canonical.split('-- Usage counters remain content-free telemetry.')[0]);
  // The earlier billing slice omits heartbeat_session. The real main baseline
  // already has this routine: retain its exact body AND its stated API ACL.
  const heartbeat = canonical.match(/CREATE OR REPLACE FUNCTION public\.heartbeat_session\([\s\S]*?\$\$;/);
  const heartbeatAcl = canonical.match(/REVOKE EXECUTE ON FUNCTION public\.heartbeat_session\([\s\S]*?TO authenticated, service_role;/);
  if (!heartbeat || !heartbeatAcl) throw new Error('historical heartbeat/ACL source absent');
  await db.exec(heartbeat[0] + '\n' + heartbeatAcl[0]);
  for (const name of ['20261013180000_account_closure_tokens.sql',
    '20261016090000_account_closure_drain_persistence.sql',
    '20261016180000_account_closure_drain_enforcement.sql',
    '20261017200000_checkout_rejection_recovery.sql']) await db.exec(source(name));
  await db.exec(`ALTER TABLE sessions ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz,
    ADD COLUMN title text,ADD COLUMN transcript text,ADD COLUMN total_words int,ADD COLUMN duration int,
    ADD COLUMN filler_counts jsonb,ADD COLUMN filler_words jsonb,ADD COLUMN accuracy double precision,
    ADD COLUMN ground_truth text,ADD COLUMN engine text,ADD COLUMN idempotency_key uuid,
    ADD COLUMN engine_version text,ADD COLUMN model_name text,ADD COLUMN device_type text,
    ADD COLUMN expires_at timestamptz,ADD COLUMN status text,ADD COLUMN next_action_signal jsonb,
    ADD COLUMN status_reason text,ADD COLUMN clarity_score double precision,ADD COLUMN wpm double precision,
    ADD COLUMN pause_metrics jsonb,ADD COLUMN ai_suggestions jsonb,ADD COLUMN custom_words jsonb;
    CREATE TABLE tier_configs(tier_name text PRIMARY KEY,max_concurrent_sessions int);
    CREATE TABLE usage_checkpoints(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid,user_id uuid,
      incremental_seconds int,engine_type text,created_at timestamptz DEFAULT now());
    CREATE FUNCTION update_user_usage(int,text,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"success":true}'::jsonb $$;`);
  for (const name of [
    '20260801000000_sessions_transcript_state.sql',
    '20260803000000_transcript_retention_newest_two.sql',
    '20260731120000_session_progress_evaluations.sql',
    '20260804000000_transcript_retention_converge_on_save.sql',
    '20260805000000_transcript_retention_preflight.sql',
    '20260819120000_complete_session_v2_atomic_retention_1314.sql',
    '20260908120000_transcript_retention_newest_one.sql',
    '20260607040000_active_recording_lease.sql',
    '20260923120000_one_active_engine_per_account_1476.sql',
    '20260926190000_session_product_marker_1258.sql',
    '20260530170000_ai_suggestion_daily_quota.sql',
    '20260910193000_ai_suggestion_authority_receipt.sql',
    '20260816223606_metrics_only_additive_1306.sql',
    '20260817140000_repoint_analytics_summary_flat_1306.sql',
  ]) await db.exec(source(name));
  // This bounded fixture creates the save RPC from its earlier retention slice
  // after reading the canonical baseline. Replay the latter's exact ACL slice
  // in native chronology; otherwise a platform anon default incorrectly sticks.
  const createAcl = [...canonical.matchAll(/REVOKE EXECUTE ON FUNCTION public\.create_session_and_update_usage\(JSONB, TEXT, UUID, TEXT, TEXT, TEXT\)[\s\S]*?TO authenticated, service_role;/g)];
  if (createAcl.length !== 1) throw new Error('historical save-RPC ACL source absent or ambiguous');
  await db.exec(createAcl[0][0]);
  // Real pre-C1 predecessors, needed by the separately observed release profiles.
  // None replaces a historical T2 object or changes its seven expected states.
  await db.exec(`ALTER TABLE public.sessions ADD COLUMN attribution_status text NOT NULL DEFAULT 'pending';
    CREATE TABLE public.objective_source_recording(session_id uuid PRIMARY KEY,user_id uuid NOT NULL);`);
  for (const name of [
    '20260803010000_session_attribution_authority.sql',
    '20260812030000_progress_cohort_mode_separation_1265.sql',
    '20260924150000_progress_evaluation_filler_counts_authority_1471.sql',
    '20260810120000_retention_purge_ai_suggestions.sql',
    '20261013120000_retention_expiry_without_superuser_1258.sql',
    '20261013140000_retention_expiry_typed_empty_array_1258.sql',
  ]) await db.exec(source(name));
  // The historical ACL remediation precedes #1476. CREATE OR REPLACE preserves
  // its ACL but #1476 restates search_path=public. Apply that exact ACL slice.
  await db.exec(`REVOKE EXECUTE ON FUNCTION public.acquire_recording_lease(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid,text,boolean) TO authenticated;
    RESET ROLE;`);
  return db;
}
// END BOUNDED FIXTURE.

describe('T2 catalog gate rejects missing or changed evidence', () => {
  it('derives the two inherited-ACL identities from platform setup and rejects the omitted-default fixture', async () => {
    const contract = t2ReleaseContract(process.cwd(), [...T2_VERSIONS, ...c1Versions]);
    const results = [];
    for (const platformFunctionDefaults of [false, true]) {
      const db = await fixture({ platformFunctionDefaults });
      try {
        await db.exec('SET ROLE closure_owner');
        for (const version of [...T2_VERSIONS, ...c1Versions]) {
          await db.exec(source(EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version).file));
        }
        await db.exec('RESET ROLE; SET search_path=public,pg_temp');
        const catalog = JSON.parse(Object.values((await db.query(t2CatalogQuery(contract.inventory))).rows[0])[0]);
        let passed = false;
        try { passed = assertT2Catalog(catalog, contract.expected).passed; } catch { /* Intentional omitted-platform negative. */ }
        results.push({ catalog, passed });
      } finally { await db.close(); }
    }
    const changed = Object.keys(results[1].catalog).filter(key => results[0].catalog[key] !== results[1].catalog[key]).sort();
    expect(changed).toEqual(['function:public.record_progress_evaluation(uuid)', 'function:public.sessions_set_transcript_state()']);
    expect(results.map(row => row.passed)).toEqual([false, true]);
    expect(Object.keys(results[1].catalog)).toHaveLength(117);
  }, 30_000);

  it('selects only exact installed126/127/128 ledger prefixes; rejects unknown, mixed and partial states', () => {
    const ledger = [...T2_VERSIONS, ...c1Versions];
    for (const count of [6, 7, 8]) {
      const contract = t2ReleaseContract(process.cwd(), ledger.slice(0, count));
      expect(contract.profile).toBe(`post-${120 + count}`);
      expect(contract.pins).toHaveLength(8);
    }
    for (const bad of [[], null, ledger.slice(1), [...ledger, '20261027231500'],
      [...T2_VERSIONS, c1Versions[1]], [...T2_VERSIONS, c1Versions[0], c1Versions[0]],
      [...ledger].reverse()]) expect(() => t2ReleaseContract(process.cwd(), bad)).toThrow('ledger');
    expect(t2ReleaseLedgerQuery()).toContain(`version >= '${T2_VERSIONS[0]}'`);
  });

  it('refuses changed or omitted C1 source bytes rather than blessing an observed catalog', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 't2-release-source-')));
    try {
      const directory = join(root, 'backend/supabase/migrations'); mkdirSync(directory, { recursive: true });
      for (const version of [...T2_VERSIONS, ...c1Versions]) {
        const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version);
        writeFileSync(join(directory, pin.file), source(pin.file));
      }
      const pin = EXACT_MIGRATION_ALLOWLIST.find(row => row.version === c1Versions[0]);
      writeFileSync(join(directory, pin.file), source(pin.file) + '\n');
      expect(() => t2ReleaseContract(root, [...T2_VERSIONS, ...c1Versions])).toThrow('source mismatch');
      rmSync(join(directory, pin.file));
      expect(() => t2ReleaseContract(root, [...T2_VERSIONS, ...c1Versions])).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('proves source-derived C1 release catalogs and refuses historical, ACL/body and mixed-snapshot evidence', async () => {
    const db = await fixture();
    const scalar = async query => Object.values((await db.query(query)).rows[0])[0];
    const readSnapshot = async contract => {
      const results = await db.exec(t2ReleaseSnapshotQuery(contract));
      return results.filter(result => result.rows?.length).map(result => String(Object.values(result.rows[0])[0]));
    };
    try {
      await db.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)');
      for (const version of T2_VERSIONS) {
        await db.exec(`SET ROLE closure_owner; ${sources[version]} RESET ROLE;
          INSERT INTO supabase_migrations.schema_migrations VALUES('${version}')`);
      }
      const old = t2ExpectedCatalog('verify', 'release');
      const beforeC1 = t2ReleaseContract(process.cwd(), T2_VERSIONS);
      const beforeRows = await readSnapshot(beforeC1);
      const futureBeforeC1 = source(beforeC1.knownAbsent.file).replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
      await db.exec('BEGIN'); await db.exec(futureBeforeC1);
      const premature = [...beforeRows]; premature[5] = await scalar(t2KnownAbsentQuery(beforeC1));
      expect(() => assertT2ReleaseSnapshot(beforeC1, premature)).toThrow('known129 function family');
      await db.exec('ROLLBACK');
      expect(assertT2ReleaseSnapshot(beforeC1, await readSnapshot(beforeC1)).passed).toBe(true);
      for (const version of c1Versions) {
        const prior = t2ReleaseContract(process.cwd(), JSON.parse(await scalar(t2ReleaseLedgerQuery())));
        expect(assertT2ReleaseSnapshot(prior, await readSnapshot(prior)).passed).toBe(true);
        await db.exec(`SET ROLE closure_owner; ${source(EXACT_MIGRATION_ALLOWLIST.find(row => row.version === version).file)} RESET ROLE`);
        // Applying without its ledger entry cannot pass as the prior state.
        const partial = await readSnapshot(prior);
        expect(() => assertT2ReleaseSnapshot(prior, partial)).toThrow();
        const historical = JSON.parse(await scalar(t2CatalogQuery(T2_INVENTORY)));
        expect(() => assertT2Catalog(historical, old)).toThrow('T2 catalog mismatch');
        await db.exec(`INSERT INTO supabase_migrations.schema_migrations VALUES('${version}')`);
        const contract = t2ReleaseContract(process.cwd(), JSON.parse(await scalar(t2ReleaseLedgerQuery())));
        const rows = await readSnapshot(contract);
        expect(assertT2ReleaseSnapshot(contract, rows).passed).toBe(true);
        const future = source(contract.knownAbsent.file).replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
        await db.exec('BEGIN');
        await db.exec(future);
        const partial129 = [...rows]; partial129[5] = await scalar(t2KnownAbsentQuery(contract));
        expect(() => assertT2ReleaseSnapshot(contract, partial129)).toThrow('known129 function family');
        await db.exec('ROLLBACK');
        expect(assertT2ReleaseSnapshot(contract, await readSnapshot(contract)).passed).toBe(true);
        await db.exec('BEGIN; CREATE FUNCTION public.settle_account_completion_billing_v1(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$');
        const overload = [...rows]; overload[5] = await scalar(t2KnownAbsentQuery(contract));
        expect(() => assertT2ReleaseSnapshot(contract, overload)).toThrow('known129 function family');
        await db.exec('ROLLBACK');
        // Exercise the actual executable, not just its library. The fake psql
        // replays THESE real PGlite readbacks; it is CLI transport proof only.
          // Keep the executable inside the ESM package, as the isolated
          // qualification runner does. An external system tmp hides that case.
          const dir = mkdtempSync(join(process.cwd(), '.t2-release-cli-'));
          try {
            writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
            writeFileSync(join(dir, 'psql'), `#!/usr/bin/env node\nimport('node:fs').then(fs=>{
const rows=JSON.parse(fs.readFileSync(process.env.T2_TEST_ROWS,'utf8'));
const query=process.argv.at(-1);fs.appendFileSync(process.env.T2_TEST_QUERIES,JSON.stringify({args:process.argv.slice(2),query,options:process.env.PGOPTIONS})+'\\n');
console.log(query.includes('objects AS')?rows.join('\\n'):rows[0]);});\n`);
            chmodSync(join(dir, 'psql'), 0o700);
            const invoke = () => spawnSync(process.execPath, ['scripts/t2-migration-postflight.mjs', 'verify', 'release'], {
              encoding: 'utf8', timeout: 10_000,
              env: { ...process.env, PATH: dir + ':' + process.env.PATH,
                T2_TEST_ROWS: join(dir, 'rows.json'), T2_TEST_QUERIES: join(dir, 'queries.jsonl') },
            });
            const accepted = invoke();
            expect({ status: accepted.status, error: accepted.stderr }).toEqual({ status: 0, error: '' });
            expect(JSON.parse(accepted.stdout).profile).toBe(contract.profile);
            const queries = readFileSync(join(dir, 'queries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
            expect(queries).toHaveLength(2);
            expect(queries.every(row => row.query.includes('READ ONLY') && row.options.includes('default_transaction_read_only=on'))).toBe(true);
            const corrupt = [...rows]; corrupt[1] = JSON.stringify({});
            writeFileSync(join(dir, 'rows.json'), JSON.stringify(corrupt));
            expect(invoke().status).toBe(1);
            const mixed = [...rows]; mixed[0] = JSON.stringify(T2_VERSIONS);
            writeFileSync(join(dir, 'rows.json'), JSON.stringify(mixed));
            expect(invoke().status).toBe(1);
          } finally { rmSync(dir, { recursive: true, force: true }); }
        const stale = [...rows]; stale[0] = JSON.stringify(T2_VERSIONS);
        expect(() => assertT2ReleaseSnapshot(contract, stale)).toThrow('ledger changed');
        for (const invalid of [[], rows.slice(1), [...rows, '{}'],
          [...rows.slice(0, 4), JSON.stringify({ checks: [] })]]) {
          expect(() => assertT2ReleaseSnapshot(contract, invalid)).toThrow();
        }
        for (const mutation of [
          'GRANT EXECUTE ON FUNCTION public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer) TO service_role',
          "CREATE OR REPLACE FUNCTION public.guard_unsettled_account_coaching_delete_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN OLD; END $$",
          'ALTER FUNCTION public.read_account_completion_status_v1(uuid,text,text) SECURITY INVOKER',
          'GRANT SELECT ON public.account_coaching_fences TO authenticated',
        ]) {
          await db.exec('BEGIN'); await db.exec(mutation);
          const changedCatalog = await scalar(t2CatalogQuery(contract.inventory));
          expect(() => assertT2Catalog(changedCatalog, contract.expected)).toThrow('catalog mismatch');
          await db.exec('ROLLBACK');
        }
      }
    } finally { await db.close(); }
  }, 30_000);

  it('retains historical table defaults and rejects the omitted-grant receipt catalog', async () => {
    const target = 'table:public.ai_suggestion_authority_receipts';
    const expected = t2ExpectedCatalog('before', T2_VERSIONS[0]);
    for (const historicalTableDefaults of [true, false]) {
      const db = await fixture({ historicalTableDefaults });
      try {
        await db.exec('SET search_path=public,pg_temp');
        // Direct catalog privileges are an independent oracle, not values copied
        // from the digest map under test. GRANT SELECT/INSERT/UPDATE is additive.
        const privileges = (await db.query(`SELECT a.privilege_type, a.is_grantable
          FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
          JOIN pg_roles r ON r.oid=a.grantee
          WHERE c.oid='public.ai_suggestion_authority_receipts'::regclass
            AND r.rolname='service_role' ORDER BY a.privilege_type`)).rows;
        expect(privileges.map(row => row.privilege_type)).toEqual(historicalTableDefaults
          ? ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
          : ['INSERT', 'SELECT', 'UPDATE']);
        expect(privileges.every(row => row.is_grantable === false)).toBe(true);
        const actual = JSON.parse(Object.values((await db.query(t2CatalogQuery(T2_INVENTORY))).rows[0])[0]);
        expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
        expect(Object.keys(expected).filter(key => actual[key] !== expected[key]))
          .toEqual(historicalTableDefaults ? [] : [target]);
        let admission;
        try { admission = assertT2Catalog(actual, expected); }
        catch (error) { admission = error.message; }
        expect(admission).toEqual(historicalTableDefaults
          ? { passed: true, objects: Object.keys(expected).length }
          : `T2 catalog mismatch: ${target}`);
        // Retained pre-correction fixture result; omission must fail closed.
        expect(actual[target]).toBe(historicalTableDefaults
          ? expected[target] : 'f2255e021f0773c930bc75db91338373');
      } finally { await db.close(); }
    }
  }, 30_000);

  it('retains the real heartbeat before Analytics/pending/U1 and rejects missing/body/ACL drift', async () => {
    const db = await fixture();
    const catalog = async () => {
      await db.exec('SET search_path=public,pg_temp');
      return JSON.parse(Object.values((await db.query(t2CatalogQuery(T2_INVENTORY))).rows[0])[0]);
    };
    try {
      for (const version of T2_VERSIONS.slice(0,3)) {
        const digest = (await db.query("SELECT md5(pg_get_functiondef('public.heartbeat_session(uuid,integer)'::regprocedure)) AS digest")).rows[0].digest;
        expect(digest).toBe('e3226a816e3a03ac5251363b069e4cbe');
        const expected = t2ExpectedCatalog('before',version);
        expect(assertT2Catalog(await catalog(),expected).passed).toBe(true);
        for (const mutation of [
          'DROP FUNCTION public.heartbeat_session(uuid,integer)',
          "CREATE OR REPLACE FUNCTION public.heartbeat_session(p_session_id uuid,p_incremental_seconds integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT '{}'::jsonb $$",
          'GRANT EXECUTE ON FUNCTION public.heartbeat_session(uuid,integer) TO anon',
          'REVOKE EXECUTE ON FUNCTION public.heartbeat_session(uuid,integer) FROM authenticated',
        ]) {
          await db.exec('BEGIN'); await db.exec(mutation);
          const changed = await catalog();
          expect(() => assertT2Catalog(changed,expected)).toThrow('catalog mismatch');
          await db.exec('ROLLBACK');
        }
        await db.exec('SET ROLE closure_owner'); await db.exec(sources[version]); await db.exec('RESET ROLE');
      }
      const digest = (await db.query("SELECT md5(pg_get_functiondef('public.heartbeat_session(uuid,integer)'::regprocedure)) AS digest")).rows[0].digest;
      expect(digest).toBe('1ba2759c5b17104f5501fe184646a211');
    } finally { await db.close(); }
  },30_000);
  it('binds all six reviewed migration files, including predecessors', () => {
    expect(() => assertT2Sources(sources)).not.toThrow();
    for (const version of T2_VERSIONS) {
      expect(() => assertT2Sources({ ...sources, [version]: sources[version] + '\n' })).toThrow('source mismatch');
      expect(() => assertT2Sources({ ...sources, [version]: undefined })).toThrow('source mismatch');
    }
  });
  it('rejects absent, omitted, extra and changed catalog identities', () => {
    const expected = { 'table:public.example': 'a'.repeat(32) };
    expect(assertT2Catalog(expected, expected).passed).toBe(true);
    for (const value of [null, {}, [], { ...expected, extra: 'b'.repeat(32) }, { 'table:public.example': 'b'.repeat(32) }]) {
      expect(() => assertT2Catalog(value, expected)).toThrow();
    }
  });
  it('reads only PostgreSQL catalogs, never application effect functions', () => {
    const query = t2CatalogQuery({ functions: ['example'], tables: ['example'], triggers: ['example'] });
    expect(query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|CALL)\b/);
    expect(query).toContain('pg_get_function_result');
    expect(query).toContain('aclexplode');
  });

  it('executes all six pre/post states and rejects causal catalog/authority drift', async () => {
    const db = await fixture();
    const catalog = async () => {
      await db.exec('SET search_path=public,pg_temp');
      return JSON.parse(Object.values((await db.query(t2CatalogQuery(T2_INVENTORY))).rows[0])[0]);
    };
    const scalar = async query => Object.values((await db.query(query)).rows[0])[0];
    try {
      await db.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)');
      for (const version of T2_VERSIONS) {
        expect(assertT2Catalog(await catalog(), t2ExpectedCatalog('before', version)).passed).toBe(true);
        expect(await scalar(t2LedgerQuery('before', version))).toBe('true');
        expect(assertT2Disabled(await scalar(t2DisabledQuery(false)), false).passed).toBe(true);
        await db.exec('SET ROLE closure_owner');
        await db.exec(sources[version]);
        await db.exec(`RESET ROLE; INSERT INTO supabase_migrations.schema_migrations VALUES('${version}')`);
        expect(assertT2Catalog(await catalog(), t2ExpectedCatalog('after', version)).passed).toBe(true);
        expect(await scalar(t2LedgerQuery('after', version))).toBe('true');
      }
      const final = t2ExpectedCatalog('verify', 'release');
      expect(assertT2Catalog(await catalog(), final).passed).toBe(true);
      expect(() => assertT2Catalog(final, t2ExpectedCatalog('after', T2_VERSIONS[1]))).toThrow();
      expect(assertT2Disabled(await scalar(t2DisabledQuery(true)), true).passed).toBe(true);
      expect(await scalar(t2AdmissionQuery(true))).toBe('true');
      const mutations = [
        "CREATE OR REPLACE FUNCTION public.begin_account_coaching_v1(p_user_id uuid,p_session_id uuid,p_operation_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$",
        'GRANT EXECUTE ON FUNCTION public.read_account_completion_status_v1(uuid,text,text) TO authenticated',
        'CREATE FUNCTION public.begin_account_coaching_v1(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$',
        'ALTER TABLE public.account_completion_stages DISABLE ROW LEVEL SECURITY',
        'GRANT SELECT ON public.account_completion_status_capabilities TO anon',
        'GRANT SELECT(token_hash) ON public.account_completion_status_capabilities TO authenticated',
        'ALTER TABLE public.account_completion_stages DROP CONSTRAINT account_completion_stages_phase_check',
        'DROP INDEX public.account_save_unsettled',
        'ALTER TABLE public.sessions DISABLE TRIGGER zz_account_save_session_obligation',
        'DROP TRIGGER ss_recording_admission_1643 ON public.active_recording_lease',
        'ALTER TABLE public.account_checkout_operations ADD COLUMN unreviewed integer',
        "ALTER FUNCTION public.read_account_completion_status_v1(uuid,text,text) SET search_path=public",
      ];
      for (const mutation of mutations) {
        await db.exec('BEGIN');
        await db.exec(mutation);
        const changed = await catalog();
        expect(() => assertT2Catalog(changed, final)).toThrow('catalog mismatch');
        await db.exec('ROLLBACK');
        expect(assertT2Catalog(await catalog(), final).passed).toBe(true);
      }
      for (const mutation of [
        'UPDATE public.account_completion_configuration SET enabled=true',
        "UPDATE public.account_completion_configuration SET scope_digest=repeat('a',64)",
        'DELETE FROM public.account_completion_configuration',
        'UPDATE public.account_billing_coordination SET checkout_workers_drained=true',
      ]) {
        await db.exec('BEGIN'); await db.exec(mutation);
        const changed = await scalar(t2DisabledQuery(true));
        expect(() => assertT2Disabled(changed, true)).toThrow('inactive authority');
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN; GRANT INSERT ON public.active_recording_lease TO authenticated');
      expect(await scalar(t2AdmissionQuery(true))).toBe('false');
      await db.exec('ROLLBACK; BEGIN; GRANT UPDATE(lease_id) ON public.active_recording_lease TO anon');
      expect(await scalar(t2AdmissionQuery(true))).toBe('false');
      await db.exec('ROLLBACK; BEGIN');
      await db.exec(`DELETE FROM supabase_migrations.schema_migrations WHERE version='${T2_VERSIONS[4]}'`);
      expect(await scalar(t2LedgerQuery('verify', 'release'))).toBe('false');
      await db.exec('ROLLBACK');
    } finally { await db.close(); }
  }, 30_000);
});

// #1684 preflight (Sam 7555): a foreign key's identity is the ORDERED COLUMN NAMES on both sides, not physical
// attribute numbers. Production auth.users stores id as physical column 2 while the fixture stores it as column 1.
describe('T2 catalog digest of a foreign key is independent of physical column order', () => {
  const inventory = { functions: ['__no_function__'], tables: ['fk_holder'], triggers: ['__no_trigger__'] };
  const digestWith = async (authUsersDdl, foreignKey) => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE SCHEMA auth; ${authUsersDdl};
        CREATE TABLE public.account_closure_attempts(id int);
        CREATE TABLE public.fk_holder(id int PRIMARY KEY, user_id uuid NOT NULL ${foreignKey});`);
      return JSON.parse(Object.values((await db.query(t2CatalogQuery(inventory))).rows[0])[0])['table:public.fk_holder'];
    } finally {
      await db.close();
    }
  };
  const idFirst = 'CREATE TABLE auth.users(id uuid PRIMARY KEY, other_id uuid UNIQUE)';
  const idSecond = 'CREATE TABLE auth.users(other_id uuid UNIQUE, id uuid PRIMARY KEY)';
  const toId = 'REFERENCES auth.users(id) ON DELETE CASCADE';
  const toOther = 'REFERENCES auth.users(other_id) ON DELETE CASCADE';

  it('the same logical reference hashes identically whatever ordinal the referenced column has', async () => {
    expect(await digestWith(idSecond, toId)).toBe(await digestWith(idFirst, toId));
  });

  it('a reference to a different column still changes the digest', async () => {
    expect(await digestWith(idFirst, toOther)).not.toBe(await digestWith(idFirst, toId));
    expect(await digestWith(idSecond, toOther)).not.toBe(await digestWith(idSecond, toId));
  });
});
