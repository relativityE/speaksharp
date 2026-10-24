// #1643 UNKNOWN-coaching fence: own disposable PostgreSQL, real quota/authority/retention/admission SQL; no provider or
// hosted calls. An UNKNOWN coaching operation can never settle on the live path, and the M5 delete guard keeps the
// account forever. The fence makes it terminal ONLY after proving under W1's locks that it never committed, and every
// writer must then refuse it. Until the fence migration exists, its cases fail as a recorded CAPABILITY gap, never as
// semantic proof; the ACL cases fail at their own assertion against the actual schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingBootstrap, closureMigration } from './account-closure-pending-fixture.mjs';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const admissionSource = 'backend/supabase/migrations/20261019202856_account_coaching_admission_1643.sql';
const completionMigration = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const quotaMigration = '20260530170000_ai_suggestion_daily_quota.sql';
const authorityMigration = '20260910193000_ai_suggestion_authority_receipt.sql';
const retentionPurgeMigration = '20260810120000_retention_purge_ai_suggestions.sql';
// The production retention expiry (no superuser bypass): it is what fires the purge trigger on a real expiry.
const retentionExpiryMigrations = ['20261013120000_retention_expiry_without_superuser_1258.sql', '20261013140000_retention_expiry_typed_empty_array_1258.sql'];
const scope = 'a'.repeat(64);
const fenceMigration = readdirSync('backend/supabase/migrations').find(f => f.endsWith('_account_coaching_unknown_fence_1643.sql')) ?? null;
const model = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8')).model;
const payload = '{"version":"gemini_coaching_v1","what_worked":"Synthetic control","what_to_try_next":"Synthetic next step"}';
// The closure request and scope are explicit arguments: the operation triple alone is never fence authority (Sam 1792829599.283729).
const FENCE_RPC = 'public.fence_account_coaching_unknown_v1(uuid,uuid,uuid,uuid,text,text)';

test('#1643 UNKNOWN-coaching fence: effective ACLs, writer refusal and serialization (native)', async t => {
  const root = mkdtempSync(join(tmpdir(), 'coaching-fence-')); const data = join(root, 'data');
  const socket = join(root, 'socket'); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))),
    PGHOST: socket, PGPORT: '5432', PGUSER: 'fence_test_admin', PGDATABASE: 'postgres' };
  const args = ['-h', socket, '-p', '5432', '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  const sql = text => execFileSync('psql', [...args, '-c', text], { env, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const json = text => JSON.parse(sql(text).split('\n').at(-1));
  /** Run a statement expected to fail; return its stderr (SQLSTATE in VERBOSITY=verbose), or null if it succeeded. */
  const failure = text => { try { sql(text); return null; } catch (error) { return String(error.stderr ?? error.message); } };
  const clients = []; const receipts = []; const baseline = {}; let started = false; let index = 0;
  const service = text => `SET ROLE service_role; ${text}`;
  const authenticated = (a, text) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.user}',false); ${text}`;
  const quota = a => authenticated(a, 'SELECT consume_ai_suggestion_quota(3)');
  const begin = a => service(`SELECT begin_account_coaching_v1('${a.user}','${a.session}','${a.operation}')`);
  const outcome = (a, value) => service(`SELECT finish_account_coaching_failure_v1('${a.user}','${a.session}','${a.operation}','${value}')`);
  const phase = a => sql(`SELECT phase FROM account_coaching_operations WHERE operation_id='${a.operation}'`);
  const persist = (a, settled = true, text = payload, ordinal = 1) => service(`SELECT persist_account_coaching_v1(
    '${a.operation}',${settled},'${a.session}','${a.user}','${text}'::jsonb,'google_gemini','${model}',
    'user_utc_day',CURRENT_DATE,3,${ordinal})`);
  const fence = (a, evidence = 'e'.repeat(64), request = a.request, scopeDigest = scope) => service(`SELECT ${FENCE_RPC.split('(')[0]}(
    '${a.operation}','${a.user}','${a.session}',${request ? `'${request}'` : 'NULL'},'${scopeDigest}','${evidence}')`);
  const claim = a => service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`);
  const statusHash = a => 'c' + a.hash.slice(1);
  const status = a => json(service(`SELECT read_account_completion_status_v1('${a.request}','${statusHash(a)}','${scope}')-'expiresAt'`));
  const remove = a => `SET ROLE fixture_auth_admin; DELETE FROM auth.users WHERE id='${a.user}'`;
  const saved = a => sql(`SELECT coalesce(ai_suggestions::text,'') FROM sessions WHERE id='${a.session}'`);
  const receiptsFor = a => Number(sql(`SELECT count(*) FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`));
  const fenceAvailable = () => sql(`SELECT to_regprocedure('${FENCE_RPC}') IS NOT NULL`) === 't';
  /** A missing fence RPC is a setup/capability failure, recorded as such; it is never semantic proof (Sam 1792828702.693899). */
  const requireFence = () => {
    if (!fenceAvailable()) throw new Error(`CAPABILITY: ${FENCE_RPC} is absent (fence migration ${fenceMigration ?? 'not present'}); setup failure, not semantic proof`);
  };
  function seed(warm = true) {
    index++; const suffix = String(index).padStart(12, '0');
    const a = { user: `b7010000-0000-4000-8000-${suffix}`, session: `b7020000-0000-4000-8000-${suffix}`,
      operation: `b7030000-0000-4000-8000-${suffix}`, hash: String(index).padStart(64, 'a'), request: '' };
    // A completed session: its save obligation is settled, so only coaching debt can hold the account.
    sql(`INSERT INTO auth.users VALUES('${a.user}','fence-${index}@example.test',now());
      INSERT INTO sessions(id,user_id,status) VALUES('${a.session}','${a.user}','completed');`);
    if (warm) sql(`INSERT INTO ai_suggestion_usage_daily(user_id,usage_date,request_count) VALUES('${a.user}',CURRENT_DATE,0)`);
    return a;
  }
  /**
   * A1 authority (Sam 1792827650.089379): a verified, CONFIRMED owner closure — the pending attempt plus the owner's
   * acknowledged, unexpired status capability for exactly this request and the enabled scope. Coaching is admitted
   * BEFORE this, because M5 refuses new admissions once closure is pending.
   */
  function confirmClosure(a, { pending = true, acknowledged = true } = {}) {
    sql(service(`SELECT issue_account_closure_pending_token('${a.user}','${a.hash}')`));
    a.request = sql(`SELECT request_id FROM account_closure_tokens WHERE user_id='${a.user}'`);
    if (!pending) return a;
    json(service(`SELECT begin_account_closure_pending('${a.user}','${a.hash}',true)`));
    sql(`INSERT INTO account_completion_coverage VALUES('${a.user}','${a.request}','${scope}',
      'synthetic native fixture legacy coverage; not production proof','synthetic native fixture portal settlement; not provider proof')`);
    assert.ok(json(service(`SELECT issue_account_completion_status_v1('${a.user}','${a.request}','${scope}','${statusHash(a)}')`))?.requestId);
    if (acknowledged) assert.equal(sql(service(`SELECT acknowledge_account_completion_status_v1('${a.user}','${a.request}','${scope}','${statusHash(a)}')`)), 't');
    // Verify, not assume, the authority the positive paths rely on.
    assert.equal(sql(`SELECT a.phase||'/'||f.phase FROM account_closure_attempts a JOIN account_billing_fences f USING(user_id,request_id)
      WHERE a.user_id='${a.user}' AND a.request_id='${a.request}'`), 'pending/pending');
    assert.equal(sql(`SELECT count(*) FROM account_completion_status_capabilities WHERE user_id='${a.user}' AND request_id='${a.request}'
      AND scope_digest='${scope}' AND (acknowledged_at IS NOT NULL)=${acknowledged} AND expires_at>clock_timestamp()`), '1');
    return a;
  }
  const uncommittedUnknown = () => { const a = seed(); json(begin(a)); json(quota(a)); assert.equal(sql(outcome(a, 'unknown')), 't'); return a; };
  /** An UNKNOWN operation that never committed (admitted, quota consumed, settled `unknown`), under a confirmed closure. */
  const unknownUncommitted = () => confirmClosure(uncommittedUnknown());
  function client(name, text, hold = false) {
    const child = spawn('psql', args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { child, stdout: '', stderr: '', exited: false }; clients.push(state);
    child.stdout.on('data', s => { state.stdout += s; }); child.stderr.on('data', s => { state.stderr += s; });
    state.done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => {
      state.exited = true; resolve({ code, stdout: state.stdout, stderr: state.stderr }); }); });
    if (hold) child.stdin.write(text + '\n'); else child.stdin.end(text + '\n'); return state;
  }
  async function waitFor(fn) { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await delay(20); } throw Error('native barrier missing'); }
  const idle = name => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='idle in transaction')`) === 't';
  const blocked = (waiter, holder) => sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${waiter}'
    AND (SELECT pid FROM pg_stat_activity WHERE application_name='${holder}')=ANY(pg_blocking_pids(pid)))`) === 't';
  try {
    execFileSync('initdb', ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F -k ${socket} -h '' -p 5432 -c max_connections=10 -c shared_buffers=16MB -c work_mem=1MB -c deadlock_timeout=100ms`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    // The actual completion chain (the same fixture the accepted native completion proof uses), split at the pending
    // bootstrap so the hosted role defaults below are in force BEFORE quota/authority/M5 run as the schema owner.
    const pending = pendingBootstrap() + '\nRESET ROLE;\n', chain = completionBootstrap();
    assert.ok(chain.startsWith(pending), 'completion fixture must begin with the pending bootstrap');
    assert.ok(recordingChain.includes(quotaMigration) && recordingChain.includes(authorityMigration));
    sql(pending);
    sql(`CREATE ROLE fixture_auth_admin NOINHERIT;
      GRANT USAGE ON SCHEMA auth TO fixture_auth_admin;
      GRANT SELECT,DELETE ON auth.users TO fixture_auth_admin;`);
    // FIDELITY (first run on S, 08:03Z): without Supabase's role defaults the fixture under-granted service_role
    // ("permission denied for table sessions" in the cache-read RPC that works in production), so ACL cases passed for
    // the wrong reason. Model the hosted defaults: service_role BYPASSRLS and ALL on public objects, anon/authenticated
    // table and function grants (RLS still applies to them), set as DEFAULT PRIVILEGES before the migrations run, so
    // each migration's own REVOKE/GRANT statements take effect exactly as they do in production. closure_owner stands
    // in for the hosted `postgres` owner (non-superuser, BYPASSRLS): definer writers run as it, and the FORCE-RLS
    // authority receipts are written as it. Its attributes are recorded below, not assumed.
    sql(`ALTER ROLE service_role BYPASSRLS; ALTER ROLE closure_owner BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO service_role, authenticated, anon;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, authenticated, anon;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role, authenticated, anon;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated, anon;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${env.PGUSER}, closure_owner IN SCHEMA public GRANT ALL ON TABLES TO service_role, authenticated, anon;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${env.PGUSER}, closure_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role, authenticated, anon;
      ALTER DEFAULT PRIVILEGES FOR ROLE ${env.PGUSER}, closure_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role, authenticated, anon;`);
    sql(chain.slice(pending.length));
    sql(`SET ROLE closure_owner; ${closureMigration(retentionPurgeMigration)}`);
    for (const file of retentionExpiryMigrations) sql(`SET ROLE closure_owner; ${closureMigration(file)}`);
    // Owner context (Sam 1792830367.408419): M6 and the fence migration run as closure_owner, the non-superuser
    // stand-in for hosted `postgres`, never as the fixture admin, so the invoker guard and every definer are owned by
    // that role exactly as in production. closure_owner owns the fixture auth schema, so M6's auth.users trigger installs.
    sql(`SET ROLE closure_owner; ${readFileSync(completionMigration, 'utf8')}`);
    sql(`UPDATE account_completion_configuration SET enabled=true,scope_digest='${scope}'`);
    // Record the effective privileges the cases below depend on (read, not assumed).
    baseline.effectivePrivileges = Object.fromEntries([
      ['service_role sessions UPDATE', "has_table_privilege('service_role','public.sessions','UPDATE')"],
      ['service_role bypassrls', "(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role')"],
      ['authenticated sessions UPDATE', "has_table_privilege('authenticated','public.sessions','UPDATE')"],
      ['service_role receipts UPDATE', "has_table_privilege('service_role','public.ai_suggestion_authority_receipts','UPDATE')"],
      ['service_role W2 EXECUTE', "has_function_privilege('service_role','public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)','EXECUTE')"],
      ['service_role coaching_operations SELECT', "has_table_privilege('service_role','public.account_coaching_operations','SELECT')"],
      ['closure_owner superuser', "(SELECT rolsuper FROM pg_roles WHERE rolname='closure_owner')"],
      ['closure_owner bypassrls', "(SELECT rolbypassrls FROM pg_roles WHERE rolname='closure_owner')"],
      ['W1 owner', "(SELECT proowner::regrole::text FROM pg_proc WHERE oid='public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)'::regprocedure)"],
      ['receipts FORCE RLS', "(SELECT relforcerowsecurity FROM pg_class WHERE oid='public.ai_suggestion_authority_receipts'::regclass)"],
    ].map(([k, q]) => [k, sql(`SELECT ${q}`)]));
    // Hosted flags this fixture models, read-only by Sam at 08:17Z (1792829877.661409); recorded, not asserted here.
    baseline.hostedRoleFlags = { source: 'Sam 1792829877.661409 read-only catalog', postgres: { rolsuper: false, rolbypassrls: true },
      service_role: { rolsuper: false, rolbypassrls: true }, authenticated: { rolsuper: false, rolbypassrls: false },
      anon: { rolsuper: false, rolbypassrls: false }, owners: { W1: 'postgres', W2: 'postgres', cacheRead: 'postgres', retentionPurge: 'postgres' },
      fixtureMapping: 'closure_owner models postgres; quota/authority/M5/retention purge, M6 and the fence migration applied as closure_owner',
      // Receipts written before this correction (commit 9921de8b and earlier) carried a stale mapping that named the
      // fixture admin for M6; their owner readbacks were already correct (Sam 1792831852.984209). Originals are kept.
      correction: 'fixtureMapping text corrected: M6 is applied as closure_owner, not the fixture admin' };
    if (fenceMigration) sql(`SET ROLE closure_owner; ${closureMigration(fenceMigration)}`);
    baseline.ownersAfterFence = Object.fromEntries(['public.fence_account_coaching_unknown_v1', 'public.guard_account_coaching_ai_suggestions_write_v1',
      'public.persist_account_coaching_v1', 'public.persist_ai_suggestion_with_authority_v1', 'public.record_ai_suggestion_cache_read_v1',
      'public.claim_account_pending_completion_v1', 'public.read_account_completion_status_v1', 'public.guard_unsettled_account_coaching_delete_v1',
      'public.purge_derived_content_on_expire'].map(f => [f, sql(`SELECT coalesce(string_agg(proowner::regrole::text||'/'||CASE WHEN prosecdef
        THEN 'definer' ELSE 'invoker' END, ','),'absent') FROM pg_proc WHERE oid IN (SELECT oid FROM pg_proc WHERE proname='${f.split('.')[1]}')`)]));
    baseline.effectivePrivilegesAfterFence = Object.fromEntries([
      ['service_role receipts INSERT', "has_table_privilege('service_role','public.ai_suggestion_authority_receipts','INSERT')"],
      ['service_role receipts UPDATE', "has_table_privilege('service_role','public.ai_suggestion_authority_receipts','UPDATE')"],
      ['service_role W2 EXECUTE', "has_function_privilege('service_role','public.persist_ai_suggestion_with_authority_v1(uuid,uuid,jsonb,text,text,text,date,integer,integer)','EXECUTE')"],
      ['cache read security', "(SELECT CASE WHEN prosecdef THEN 'definer' ELSE 'invoker' END FROM pg_proc WHERE oid='public.record_ai_suggestion_cache_read_v1(uuid,uuid)'::regprocedure)"],
      ['ai_suggestions guard security', "coalesce((SELECT CASE WHEN prosecdef THEN 'definer' ELSE 'invoker' END FROM pg_proc WHERE proname='guard_account_coaching_ai_suggestions_write_v1'),'absent')"],
      ['fence RPC service_role EXECUTE', `coalesce((SELECT has_function_privilege('service_role',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid=to_regprocedure('${FENCE_RPC}')),false)`],
      ['fence RPC authenticated EXECUTE', `coalesce((SELECT has_function_privilege('authenticated',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid=to_regprocedure('${FENCE_RPC}')),false)`],
    ].map(([k, q]) => [k, sql(`SELECT ${q}`)]));

    // BASELINE (observed, not asserted): what the actual schema at this commit permits today. Recorded so the RED below
    // is read against real behavior, and so the fix's effect is measurable.
    {
      const a = seed(); json(begin(a)); json(quota(a));
      baseline.serviceRoleDirectAiSuggestionsUpdate = failure(service(`UPDATE sessions SET ai_suggestions='{"x":1}'::jsonb WHERE id='${a.session}'`)) === null ? 'succeeded' : 'refused';
      baseline.serviceRoleDirectW2Execute = failure(service(`SELECT persist_ai_suggestion_with_authority_v1('${a.session}','${a.user}','${payload}'::jsonb,'google_gemini','${model}','user_utc_day',CURRENT_DATE,3,1)`)) === null ? 'succeeded' : 'refused';
      baseline.serviceRoleDirectReceiptUpdate = failure(service(`UPDATE ai_suggestion_authority_receipts SET cache_read_count=cache_read_count WHERE user_id='${a.user}'`)) === null ? 'succeeded' : 'refused';
      const b = unknownUncommitted();
      const late = failure(persist(b, true));
      baseline.lateW1OnUncommittedUnknown = late === null ? `succeeded; phase=${phase(b)}; saved=${saved(b) !== ''}` : 'refused';
      baseline.authDeleteWithUnknown = (failure(remove(b)) ?? '').match(/55000|coaching operation unsettled/) ? 'blocked_55000' : 'not_blocked';
      baseline.fenceRpc = fenceAvailable() ? 'present' : 'absent';
      baseline.fenceMigration = fenceMigration;
    }

    await t.test('ACL: service_role cannot write sessions.ai_suggestions directly (UPDATE)', () => {
      const a = seed();
      assert.match(failure(service(`UPDATE sessions SET ai_suggestions='{"x":1}'::jsonb WHERE id='${a.session}'`)) ?? 'SUCCEEDED', /42501: sessions\.ai_suggestions is written only by the coaching authority/);
      assert.equal(saved(a), '');
    });
    await t.test('ACL: authenticated owner cannot write sessions.ai_suggestions directly', () => {
      const a = seed();
      assert.match(failure(authenticated(a, `UPDATE sessions SET ai_suggestions='{"x":1}'::jsonb WHERE id='${a.session}'`)) ?? 'SUCCEEDED', /42501/);
      assert.equal(saved(a), '');
    });
    await t.test('ACL: service_role cannot INSERT a session that carries ai_suggestions', () => {
      const a = seed(); const extra = `b7090000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      assert.match(failure(service(`INSERT INTO sessions(id,user_id,ai_suggestions) VALUES('${extra}','${a.user}','{"x":1}'::jsonb)`)) ?? 'SUCCEEDED', /42501: sessions\.ai_suggestions is written only by the coaching authority/);
    });
    await t.test('ACL: service_role cannot call the inner writer W2 directly', () => {
      const a = seed(); json(quota(a));
      assert.match(failure(service(`SELECT persist_ai_suggestion_with_authority_v1('${a.session}','${a.user}','${payload}'::jsonb,'google_gemini','${model}','user_utc_day',CURRENT_DATE,3,1)`)) ?? 'SUCCEEDED', /42501: permission denied for function persist_ai_suggestion_with_authority_v1/);
      assert.equal(saved(a), ''); assert.equal(receiptsFor(a), 0);
    });
    await t.test('ACL: service_role cannot INSERT or UPDATE authority receipts directly', () => {
      const a = seed(); json(begin(a)); json(quota(a)); json(persist(a));
      assert.match(failure(service(`UPDATE ai_suggestion_authority_receipts SET model='forged' WHERE user_id='${a.user}'`)) ?? 'SUCCEEDED', /42501: permission denied for table ai_suggestion_authority_receipts/);
      assert.match(failure(service(`INSERT INTO ai_suggestion_authority_receipts(session_id,user_id,provider,model,provider_request_made,
        quota_scope,quota_utc_date,quota_limit,quota_request_number,suggestion_sha256) SELECT session_id,user_id,provider,model,true,
        quota_scope,quota_utc_date,quota_limit,quota_request_number,suggestion_sha256 FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`)) ?? 'SUCCEEDED', /42501: permission denied for table ai_suggestion_authority_receipts/);
    });
    await t.test('REGRESSION: legitimate writers still work (W1 persist, cache read, retention purge, non-coaching session update)', () => {
      // An older completed take with text, plus a newer one, so the real newest-one expiry selects the older take.
      const a = seed();
      sql(`UPDATE sessions SET transcript='Synthetic older transcript',created_at=now()-interval '1 hour' WHERE id='${a.session}';
        INSERT INTO sessions(id,user_id,status,transcript) VALUES(gen_random_uuid(),'${a.user}','completed','Synthetic newer transcript');`);
      json(begin(a)); json(quota(a));
      assert.deepEqual(json(persist(a)), JSON.parse(payload)); assert.equal(phase(a), 'completed'); assert.equal(receiptsFor(a), 1);
      assert.equal(sql(service(`SELECT record_ai_suggestion_cache_read_v1('${a.session}','${a.user}')`)), 't');
      assert.equal(sql(`SELECT cache_read_count FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`), '1');
      assert.equal(failure(service(`UPDATE sessions SET title='renamed' WHERE id='${a.session}'`)), null);
      assert.equal(json(service(`SELECT expire_transcripts_newest_one('${a.user}',500)`)).expired_count, 1);
      assert.equal(sql(`SELECT transcript_state FROM sessions WHERE id='${a.session}'`), 'expired');
      assert.equal(saved(a), '', 'retention purge must still null derived coaching on a real expiry');
    });
    await t.test('FENCE: fenced UNKNOWN refuses a late W1 with 55000 and changes nothing', () => {
      requireFence();
      const a = unknownUncommitted(); assert.equal(sql(fence(a)), 't'); assert.equal(phase(a), 'fenced_unknown');
      assert.match(failure(persist(a, true)) ?? 'SUCCEEDED', /55000/);
      assert.equal(saved(a), ''); assert.equal(receiptsFor(a), 0); assert.equal(phase(a), 'fenced_unknown');
      assert.equal(sql(outcome(a, 'refused')), 'f'); assert.equal(phase(a), 'fenced_unknown');
    });
    await t.test('FENCE: refuses without a confirmed closure, and refuses admitted, completed, wrong triple and committed digests', () => {
      requireFence();
      // Missing / unconfirmed / wrong authority: each refused, each leaving the op UNKNOWN.
      const noRequest = uncommittedUnknown();
      assert.match(failure(fence(noRequest, 'e'.repeat(64), null)) ?? 'SUCCEEDED', /confirmed account closure/);
      const notPending = confirmClosure(uncommittedUnknown(), { pending: false });
      assert.match(failure(fence(notPending)) ?? 'SUCCEEDED', /confirmed account closure/);
      const unacknowledged = confirmClosure(uncommittedUnknown(), { acknowledged: false });
      assert.match(failure(fence(unacknowledged)) ?? 'SUCCEEDED', /confirmed account closure/);
      const expired = unknownUncommitted();
      sql(`UPDATE account_completion_status_capabilities SET expires_at=now()-interval '1 second' WHERE user_id='${expired.user}'`);
      assert.match(failure(fence(expired)) ?? 'SUCCEEDED', /confirmed account closure/);
      const owner = unknownUncommitted(), other = unknownUncommitted();
      assert.match(failure(fence(owner, 'e'.repeat(64), other.request)) ?? 'SUCCEEDED', /confirmed account closure/, "another account's request");
      assert.match(failure(fence(owner, 'e'.repeat(64), owner.request, 'b'.repeat(64))) ?? 'SUCCEEDED', /confirmed account closure/, 'wrong scope');
      for (const x of [noRequest, notPending, unacknowledged, expired, owner, other]) assert.equal(phase(x), 'unknown');
      // Each op below is under a confirmed closure, so its refusal is for the named state, not for missing authority.
      const admitted = seed(); json(begin(admitted)); confirmClosure(admitted);
      assert.match(failure(fence(admitted)) ?? 'SUCCEEDED', /not fenceable/); assert.equal(phase(admitted), 'admitted');
      const completed = seed(); json(begin(completed)); json(quota(completed)); json(persist(completed)); confirmClosure(completed);
      assert.match(failure(fence(completed)) ?? 'SUCCEEDED', /not fenceable/); assert.equal(phase(completed), 'completed');
      const unknownSaved = seed(); json(begin(unknownSaved)); json(quota(unknownSaved)); json(persist(unknownSaved, false));
      confirmClosure(unknownSaved); assert.equal(phase(unknownSaved), 'unknown');
      assert.match(failure(fence(unknownSaved)) ?? 'SUCCEEDED', /not fenceable/, 'an UNKNOWN op whose persist committed is not fenceable');
      const a = unknownUncommitted(), b = confirmClosure(seed());
      assert.match(failure(fence({ ...a, user: b.user, request: b.request })) ?? 'SUCCEEDED', /not found/);
      assert.match(failure(fence({ ...a, session: b.session })) ?? 'SUCCEEDED', /not found/);
      assert.equal(phase(a), 'unknown');
    });
    await t.test('FENCE: idempotent for the same evidence; a different evidence digest is refused', () => {
      requireFence();
      const a = unknownUncommitted(); assert.equal(sql(fence(a)), 't'); assert.equal(sql(fence(a)), 't');
      assert.match(failure(fence(a, 'f'.repeat(64))) ?? 'SUCCEEDED', /evidence differs/);
    });
    await t.test('M6: UNKNOWN holds the real claim and status; after the fence both proceed and report the outcome unknown', () => {
      requireFence();
      const a = unknownUncommitted();
      assert.deepEqual(json(claim(a)), { outcome: 'pending' }, 'an UNKNOWN op must hold the real claim');
      assert.equal(status(a)?.reason, 'coaching_unsettled');
      assert.equal(sql(fence(a)), 't');
      // Option A (Sam decision pending, 1792830189.964259): the reply keeps the EXACT closed key set the deployed Edge
      // parser accepts; the unknown provider outcome is recorded in the content-free audit row instead.
      assert.deepEqual(status(a), { outcome: 'pending', requestId: a.request, reason: 'ready', canRetry: false });
      assert.equal(sql(`SELECT provider_outcome FROM account_coaching_fences WHERE operation_id='${a.operation}'`), 'unknown');
      const grant = json(claim(a));
      assert.ok(grant?.executionId, JSON.stringify(grant)); assert.equal(grant.requestId, a.request);
      assert.equal(status(a)?.outcome, 'processing');
    });
    await t.test('GUARD: UNKNOWN blocks Auth deletion; fenced UNKNOWN allows it and the audit row survives', () => {
      requireFence();
      const a = unknownUncommitted(); assert.match(failure(remove(a)) ?? 'SUCCEEDED', /55000/);
      assert.equal(sql(fence(a)), 't'); assert.equal(failure(remove(a)), null);
      assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${a.user}'`), '0');
      assert.equal(sql(`SELECT count(*) FROM account_coaching_fences WHERE operation_id='${a.operation}'`), '1');
      assert.equal(sql(`SELECT count(*) FROM account_coaching_fences f WHERE f::text LIKE '%${a.user}%' OR f::text LIKE '%${a.user.replaceAll('-', '')}%'`), '0', 'no plaintext uid');
    });
    for (const first of ['W1', 'fence']) {
      await t.test(`SERIALIZATION: ${first} first, the other waits on the same locks`, async () => {
        requireFence();
        const a = unknownUncommitted();
        const h = `fence_holder_${index}`, w = `fence_waiter_${index}`;
        const holder = client(h, `BEGIN; ${first === 'W1' ? persist(a, true) : fence(a)};`, true);
        await waitFor(() => idle(h));
        const waiter = client(w, (first === 'W1' ? fence(a) : persist(a, true)) + ';');
        await waitFor(() => waiter.exited || blocked(w, h)); const observedBlock = blocked(w, h);
        holder.child.stdin.end('COMMIT;\n'); const hr = await holder.done, wr = await waiter.done;
        receipts.push({ race: `${first}-first`, observedBlock, holder: hr, waiter: wr });
        assert.equal(observedBlock, true); assert.equal(hr.code, 0, hr.stderr);
        if (first === 'W1') { assert.match(wr.stderr, /not fenceable/, 'fence must refuse an op whose persist committed'); assert.equal(phase(a), 'unknown'); }
        else { assert.notEqual(wr.code, 0); assert.match(wr.stderr, /55000/); assert.equal(saved(a), ''); assert.equal(phase(a), 'fenced_unknown'); }
      });
    }
  } finally {
    for (const c of clients) if (!c.child.stdin.destroyed) c.child.stdin.end();
    if (started) execFileSync('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(c => c.done));
    mkdirSync('artifacts/account-coaching-fence', { recursive: true });
    // Bind every bootstrap/full-chain dependency, not only the new files (Sam 1792829650.580399): both fixture helpers,
    // the token-test SQL fixture they embed, and every migration they or this test read.
    const helpers = ['tests/db/account-closure-pending-fixture.mjs', 'tests/db/account-completion-fixture.mjs',
      'tests/db/account-closure-tokens.integration.test.ts'];
    const read = [...new Set([...helpers.slice(0, 2).flatMap(f => [...readFileSync(f, 'utf8').matchAll(/'(\d{14}_[a-z0-9_]+\.sql)'/g)].map(m => m[1])),
      ...recordingChain, quotaMigration, authorityMigration, retentionPurgeMigration, ...retentionExpiryMigrations])].map(f => `backend/supabase/migrations/${f}`);
    const files = ['tests/db/account-coaching-fence.realpg.mjs', ...helpers, ...read, admissionSource, completionMigration,
      'backend/supabase/functions/get-ai-suggestions/contract.json',
      ...(fenceMigration ? [`backend/supabase/migrations/${fenceMigration}`] : [])].filter((f, i, all) => all.indexOf(f) === i);
    writeFileSync('artifacts/account-coaching-fence/receipts.json', JSON.stringify({ createdAt: new Date().toISOString(),
      boundary: 'native PostgreSQL; actual completion chain incl. quota/authority/retention/M5/M6 SQL; fixture Auth; zero hosted/provider calls',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), baseline, receipts }, null, 2) + '\n');
    rmSync(root, { recursive: true, force: true });
  }
});
