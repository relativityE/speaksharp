// #1643 isolated local/stale retirement proposal: disposable native PostgreSQL with real
// migration chain and fixture Auth. Independent transactions prove overlap through
// pg_blocking_pids. No hosted database, provider, deployment, or production deletion.
// Startup/capability failures are not semantic proof. Based on account-coaching-fence.realpg.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, realpathSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingBootstrap, closureMigration } from './account-closure-pending-fixture.mjs';
import { completionBootstrap, recordingChain } from './account-completion-fixture.mjs';

const admissionSource = 'backend/supabase/migrations/20261019202856_account_coaching_admission_1643.sql';
const completionMigration = 'backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql';
const retirementMigration = 'backend/supabase/migrations/20261110173548_account_coaching_local_retirement.sql';
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
/**
 * One PostgreSQL v3 simple-query message over the fixture's Unix socket or opt-in loopback TCP, like `psql -c`:
 * argv: JSON connection options, user, database, SQL file. Exit 1 with `ERROR:  <SQLSTATE>: <message>` on server error;
 * exit 3 if the connection ends before the terminal ReadyForQuery (an interrupted query is never reported complete).
 */
const SIMPLE_QUERY = `
import net from 'node:net'; import { readFileSync } from 'node:fs'; import process from 'node:process'; import { Buffer } from 'node:buffer';
const [connection, user, database, file] = process.argv.slice(1);
const int32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = s => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const startup = Buffer.concat([int32(196608), cstr('user'), cstr(user), cstr('database'), cstr(database),
  cstr('client_encoding'), cstr('UTF8'), Buffer.from([0])]);
const query = cstr(readFileSync(file, 'utf8'));
const socket = net.createConnection(JSON.parse(connection));
let buffer = Buffer.alloc(0), queried = false, finished = false, error = null;
const fail = message => { process.stderr.write(message + '\\n'); process.exit(2); };
socket.on('error', e => fail('simple-query transport: ' + e.message));
socket.on('connect', () => socket.write(Buffer.concat([int32(startup.length + 4), startup])));
socket.on('close', () => {
  if (finished) return;
  process.stderr.write((error ? error + '\\n' : '') + 'simple-query transport: connection closed before ReadyForQuery\\n');
  process.exit(3);
});
socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 5 && buffer.length >= 1 + buffer.readInt32BE(1)) {
    const type = String.fromCharCode(buffer[0]), body = buffer.subarray(5, 1 + buffer.readInt32BE(1));
    buffer = buffer.subarray(1 + buffer.readInt32BE(1));
    if (type === 'R' && body.readInt32BE(0) !== 0) fail('simple-query transport: fixture must use trust authentication');
    if (type === 'E' && !error) {
      const fields = {}; let at = 0;
      while (body[at]) { const end = body.indexOf(0, at + 1); fields[String.fromCharCode(body[at])] = body.toString('utf8', at + 1, end); at = end + 1; }
      error = 'ERROR:  ' + fields.C + ': ' + fields.M;
    }
    if (type !== 'Z') continue;
    if (!queried && !error) { queried = true; socket.write(Buffer.concat([Buffer.from('Q'), int32(query.length + 4), query])); continue; }
    finished = true; socket.end(Buffer.from([0x58, 0, 0, 0, 4]));
    if (error) { process.stderr.write(error + '\\n'); process.exitCode = 1; }
  }
});
`;

test('#1643 local and stale coaching retirement: native concurrent transactions', async t => {
  // Resolve one installed toolchain, even under the evidence runner's sanitized PATH.
  // No download, inherited connection configuration, or external database fallback.
  const names = ['initdb', 'pg_ctl', 'psql'];
  let binaries;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin']) {
    if (!isAbsolute(directory)) continue;
    try {
      binaries = Object.fromEntries(names.map(name => {
        const file = realpathSync(join(directory, name)); accessSync(file, constants.X_OK); return [name, file];
      }));
      break;
    } catch { /* Only a complete installed toolchain is eligible. */ }
  }
  assert.ok(binaries, 'NOT RUN: installed local PostgreSQL initdb/pg_ctl/psql toolchain unavailable');
  const root = mkdtempSync(join(tmpdir(), 'coaching-fence-')); const data = join(root, 'data');
  const socket = join(root, 'socket'); mkdirSync(socket);
  // Explicit opt-in for runners without Unix sockets. Never use an external host.
  const tcp = process.env.COACHING_FENCE_TCP === '1';
  let port = '5432';
  if (tcp) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    port = String(probe.address().port);
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))),
    PGHOST: tcp ? '127.0.0.1' : socket, PGPORT: port, PGUSER: 'fence_test_admin', PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
  const connection = JSON.stringify(tcp ? { host: '127.0.0.1', port: Number(port) } : { path: join(socket, `.s.PGSQL.${port}`) });
  const args = ['-h', env.PGHOST, '-p', port, '-U', env.PGUSER, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  // Linux caps ONE argv string at 128 KiB (MAX_ARG_STRLEN; CI run 40079862636 failed `spawnSync psql E2BIG` on the
  // ~254 KB completion chain), far below macOS. `psql -f`/stdin would split the text into autocommitted statements and
  // change bootstrap atomicity (Sam 1792832242.032489). Larger SQL therefore goes from a file in this test's own temp
  // root as the SAME single simple-query message `psql -c` sends: one implicit transaction divided only by the text's own
  // BEGIN/COMMIT, stopping at the first error, with its SET ROLE/SET LOCAL context unchanged. It returns no rows.
  let statementFiles = 0;
  const sql = text => {
    const options = { env, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] };
    if (Buffer.byteLength(text) <= 100_000) return execFileSync(binaries.psql, [...args, '-c', text], options).trim();
    const file = join(root, `statement-${++statementFiles}.sql`); writeFileSync(file, text);
    return execFileSync(process.execPath, ['--input-type=module', '-e', SIMPLE_QUERY, connection,
      env.PGUSER, env.PGDATABASE, file], { ...options, timeout: 120_000 }).trim();
  };
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
  const claim = a => service(`SELECT claim_account_pending_completion_v1('${a.user}','${a.request}','${scope}')`);
  const statusHash = a => 'c' + a.hash.slice(1);
  const status = a => json(service(`SELECT read_account_completion_status_v1('${a.request}','${statusHash(a)}','${scope}')-'expiresAt'`));
  const remove = a => `SET ROLE fixture_auth_admin; DELETE FROM auth.users WHERE id='${a.user}'`;
  const saved = a => sql(`SELECT coalesce(ai_suggestions::text,'') FROM sessions WHERE id='${a.session}'`);
  const receiptsFor = a => Number(sql(`SELECT count(*) FROM ai_suggestion_authority_receipts WHERE user_id='${a.user}'`));
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
    const child = spawn(binaries.psql, args, { env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    execFileSync(binaries.initdb, ['-D', data, '-U', env.PGUSER, '-A', 'trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8' });
    execFileSync(binaries.pg_ctl, ['-D', data, '-l', join(root, 'postgres.log'), '-w', 'start', '-o',
      `-F ${tcp ? "-k '' -h 127.0.0.1" : `-k ${socket} -h ''`} -p ${port} -c max_connections=10 -c shared_buffers=16MB -c work_mem=1MB -c deadlock_timeout=100ms`], { encoding: 'utf8' });
    started = true; assert.equal(sql("SELECT current_setting('data_directory')"), data);
    baseline.transport = { mode: tcp ? 'loopback TCP' : 'Unix socket', host: env.PGHOST, port,
      listenAddresses: sql("SELECT current_setting('listen_addresses')"),
      socketDirectories: sql("SELECT current_setting('unix_socket_directories')") };
    assert.equal(baseline.transport.listenAddresses, tcp ? '127.0.0.1' : '');
    assert.equal(baseline.transport.socketDirectories, tcp ? '' : socket);
    // TRANSPORT CONTROL: the same multi-statement text through `psql -c` and (padded past 100 KB) through the simple-query
    // sender must commit what its own BEGIN/COMMIT commits, roll back the failing implicit transaction, and report the
    // same SQLSTATE. Proves the large-text route does not change atomicity before any bootstrap relies on it.
    {
      const probe = (prefix, pad = '') => `CREATE TABLE ${prefix}_a(); BEGIN; CREATE TABLE ${prefix}_b(); COMMIT;
        CREATE TABLE ${prefix}_c(); SET LOCAL statement_timeout = '5s'; SELECT 1/0;${pad}`;
      const outcome = prefix => ['a', 'b', 'c'].map(suffix => sql(`SELECT to_regclass('${prefix}_${suffix}') IS NOT NULL`));
      const viaArgument = failure(probe('transport_argument'));
      const viaMessage = failure(probe('transport_message', '\n-- ' + 'x'.repeat(110_000)));
      assert.equal(statementFiles, 1, 'the padded probe must take the large-text route');
      assert.match(viaArgument ?? 'SUCCEEDED', /22012/); assert.match(viaMessage ?? 'SUCCEEDED', /22012/);
      const argument = outcome('transport_argument'), message = outcome('transport_message');
      assert.deepEqual(argument, ['t', 't', 'f'], 'psql -c reference semantics');
      assert.deepEqual(message, argument, 'large-text route changed atomicity');
      // DISCONNECT CONTROL: a backend that dies mid-query (FATAL, then the socket closes with no ReadyForQuery) must fail.
      const disconnected = failure(`SELECT pg_terminate_backend(pg_backend_pid());\n-- ${'x'.repeat(110_000)}`);
      assert.match(disconnected ?? 'SUCCEEDED', /57P01/);
      assert.match(disconnected ?? 'SUCCEEDED', /connection closed before ReadyForQuery/);
      baseline.transportControl = { argument, message, argumentError: viaArgument.split('\n')[0], messageError: viaMessage.split('\n')[0],
        disconnect: disconnected.split('\n').slice(0, 2) };
      sql('DROP TABLE transport_argument_a, transport_argument_b, transport_message_a, transport_message_b');
    }
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
    sql(`SET ROLE closure_owner; ${readFileSync(retirementMigration, 'utf8')}`);
    baseline.serverVersion = sql('SELECT version()');
    const local = a => service(`SELECT finish_account_coaching_local_v1('${a.user}','${a.session}','${a.operation}')`);
    const expired = (a, evidence = 'e'.repeat(64)) => service(`SELECT fence_account_coaching_expired_v1('${a.operation}','${a.user}','${a.session}','${a.request}','${scope}','${evidence}')`);
    const age = a => sql(`UPDATE account_coaching_operations SET admitted_at=clock_timestamp()-interval '16 minutes',updated_at=clock_timestamp()-interval '16 minutes' WHERE operation_id='${a.operation}'`);
    const audit = (a, kind) => json(`SELECT to_jsonb(f) FROM account_coaching_${kind}_fences f WHERE operation_id='${a.operation}'`);
    const digests = a => json(`SELECT jsonb_build_array(suggestion_sha256,completion_sha256) FROM account_coaching_operations WHERE operation_id='${a.operation}'`);
    const prepared = () => { const a = unknownUncommitted(); age(a); return a; };
    async function race(a, label, holderSQL, waiterSQL) {
      const h = `local_holder_${index}`, w = `local_waiter_${index}`;
      const holder = client(h, `BEGIN; ${holderSQL};`, true);
      await waitFor(() => idle(h));
      const waiter = client(w, waiterSQL + ';');
      let observedBlock;
      try { await waitFor(() => waiter.exited || blocked(w, h)); observedBlock = blocked(w, h); }
      finally { holder.child.stdin.end('COMMIT;\n'); }
      const hr = await holder.done, wr = await waiter.done;
      receipts.push({ race: label, operation: a.operation, observedBlock, holder: hr, waiter: wr });
      assert.equal(observedBlock, true, `${label}: must observe pg_blocking_pids, not infer timing`);
      assert.equal(hr.code, 0, hr.stderr);
      return wr;
    }

    await t.test('ACL: only service role can call local and expiry retirement; audit tables inaccessible', () => {
      const a = prepared();
      for (const signature of ['finish_account_coaching_local_v1(uuid,uuid,uuid)', 'fence_account_coaching_expired_v1(uuid,uuid,uuid,uuid,text,text)']) {
        for (const role of ['anon','authenticated','service_role']) {
          assert.equal(sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE')`), role === 'service_role' ? 't' : 'f');
        }
      }
      for (const role of ['anon','authenticated']) {
        for (const statement of [local(a), expired(a)]) assert.match(failure(statement.replace('SET ROLE service_role', `SET ROLE ${role}`)) ?? 'SUCCEEDED', /42501/);
      }
      for (const kind of ['local','expiry']) for (const role of ['anon','authenticated','service_role']) {
        assert.match(failure(`SET ROLE ${role}; SELECT * FROM account_coaching_${kind}_fences`) ?? 'SUCCEEDED', /42501/);
        assert.equal(sql(`SELECT has_table_privilege('${role}','account_coaching_${kind}_fences','INSERT,UPDATE,DELETE')`), 'f');
      }
    });

    await t.test('SERIALIZATION: persistence holds locks; local retirement waits and preserves committed digests', async () => {
      const a = prepared();
      const wr = await race(a, 'persist-before-local', persist(a, false), local(a));
      assert.equal(wr.code, 0, wr.stderr); assert.equal(phase(a), 'fenced_local');
      const f = audit(a, 'local');
      assert.equal(f.provider_outcome, 'unknown'); assert.equal(f.local_persistence, 'committed');
      assert.deepEqual([f.suggestion_sha256,f.completion_sha256], digests(a));
      assert.ok(f.suggestion_sha256 && f.completion_sha256);
      assert.equal(receiptsFor(a), 1); assert.deepEqual(JSON.parse(saved(a)), JSON.parse(payload));
      assert.match(failure(persist(a, false)) ?? 'SUCCEEDED', /55000.*coaching operation fenced/);
      assert.equal(sql(local(a)), 't');
    });

    await t.test('SERIALIZATION: local retirement holds locks; persistence waits and is refused', async () => {
      const a = prepared();
      const wr = await race(a, 'local-before-persist', local(a), persist(a, false));
      assert.notEqual(wr.code, 0); assert.match(wr.stderr, /55000.*coaching operation fenced/);
      assert.equal(phase(a), 'fenced_local'); assert.equal(saved(a), ''); assert.equal(receiptsFor(a), 0);
      assert.equal(audit(a, 'local').local_persistence, 'uncommitted');
    });

    await t.test('SERIALIZATION: fresh persistence wins; waiting stale recovery rechecks age and refuses', async () => {
      const a = prepared();
      const wr = await race(a, 'persist-before-expiry-age-recheck', persist(a, false), expired(a));
      assert.notEqual(wr.code, 0); assert.match(wr.stderr, /55000.*not expired or not fenceable/);
      assert.equal(phase(a), 'unknown'); assert.equal(receiptsFor(a), 1);
      assert.equal(sql(`SELECT count(*) FROM account_coaching_expiry_fences WHERE operation_id='${a.operation}'`), '0');
      const before = digests(a); age(a);
      assert.equal(sql(expired(a)), 't');
      const f = audit(a, 'expiry'); assert.deepEqual([f.suggestion_sha256,f.completion_sha256], before);
      assert.equal(f.provider_outcome, 'unknown'); assert.equal(f.local_persistence, 'committed');
      assert.match(failure(persist(a, false)) ?? 'SUCCEEDED', /55000.*coaching operation fenced/);
    });

    await t.test('SERIALIZATION: stale retirement holds locks; persistence waits and is refused', async () => {
      const a = prepared();
      const wr = await race(a, 'expiry-before-persist', expired(a), persist(a, false));
      assert.notEqual(wr.code, 0); assert.match(wr.stderr, /55000.*coaching operation fenced/);
      assert.equal(phase(a), 'fenced_expired'); assert.equal(saved(a), ''); assert.equal(receiptsFor(a), 0);
      assert.equal(audit(a, 'expiry').local_persistence, 'uncommitted');
    });

    await t.test('SERIALIZATION: operation refresh under locks invalidates stale candidate after wait', async () => {
      const a = prepared();
      const refresh = `SELECT 1 FROM user_profiles WHERE id='${a.user}' FOR UPDATE;
        SELECT pg_advisory_xact_lock(hashtextextended('account-billing:'||'${a.user}',0));
        UPDATE account_coaching_operations SET updated_at=clock_timestamp() WHERE operation_id='${a.operation}'`;
      const wr = await race(a, 'timestamp-refresh-before-expiry', refresh, expired(a));
      assert.notEqual(wr.code, 0); assert.match(wr.stderr, /55000.*not expired or not fenceable/);
      assert.equal(phase(a), 'unknown');
    });

    for (const kind of ['local', 'expiry']) {
      await t.test(`${kind}: exact replay, deletion/status/claim barriers, Auth cascade, audit survival`, () => {
        const a = prepared(), retire = kind === 'local' ? local : expired;
        assert.equal(status(a).reason, 'coaching_unsettled');
        assert.deepEqual(json(claim(a)), { outcome: 'pending' });
        assert.match(failure(remove(a)) ?? 'SUCCEEDED', /55000/);
        assert.equal(sql(retire(a)), 't'); assert.equal(sql(retire(a)), 't');
        assert.equal(status(a).reason, 'ready');
        assert.ok(json(claim(a)).executionId);
        const before = audit(a, kind);
        assert.equal(failure(remove(a)), null);
        assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${a.user}'`), '0');
        assert.equal(sql(`SELECT count(*) FROM account_coaching_operations WHERE operation_id='${a.operation}'`), '0');
        assert.deepEqual(audit(a, kind), before);
        assert.equal(sql(retire(a)), 't');
        const wrong = { ...a, session: 'b7020000-0000-4000-8000-999999999999' };
        if (kind === 'local') assert.equal(sql(retire(wrong)), 'f');
        else {
          assert.match(failure(retire(wrong)) ?? 'SUCCEEDED', /55000/);
          assert.match(failure(expired(a, 'd'.repeat(64))) ?? 'SUCCEEDED', /55000/);
        }
        assert.ok(failure(persist(a, false)), 'late writer after Auth deletion cannot succeed');
        assert.ok(!JSON.stringify(before).includes(a.user), 'audit must not contain plaintext user identity');
      });
    }
  } finally {
    for (const c of clients) if (!c.child.stdin.destroyed) c.child.stdin.end();
    if (started) execFileSync(binaries.pg_ctl, ['-D', data, '-w', 'stop', '-m', 'immediate'], { encoding: 'utf8' });
    await Promise.allSettled(clients.map(c => c.done));
    mkdirSync('artifacts/account-coaching-local-fence', { recursive: true });
    // Bind every bootstrap/full-chain dependency, not only the new files (Sam 1792829650.580399): both fixture helpers,
    // the token-test SQL fixture they embed, and every migration they or this test read.
    const helpers = ['tests/db/account-closure-pending-fixture.mjs', 'tests/db/account-completion-fixture.mjs',
      'tests/db/account-closure-tokens.integration.test.ts'];
    const read = [...new Set([...helpers.slice(0, 2).flatMap(f => [...readFileSync(f, 'utf8').matchAll(/'(\d{14}_[a-z0-9_]+\.sql)'/g)].map(m => m[1])),
      ...recordingChain, quotaMigration, authorityMigration, retentionPurgeMigration, ...retentionExpiryMigrations])].map(f => `backend/supabase/migrations/${f}`);
    const files = ['tests/db/account-coaching-local-fence.realpg.mjs', retirementMigration, ...helpers, ...read, admissionSource, completionMigration,
      'backend/supabase/functions/get-ai-suggestions/contract.json',
      ...(fenceMigration ? [`backend/supabase/migrations/${fenceMigration}`] : [])].filter((f, i, all) => all.indexOf(f) === i);
    writeFileSync('artifacts/account-coaching-local-fence/receipts.json', JSON.stringify({ createdAt: new Date().toISOString(),
      startupCompleted: started, overlappingTransactionsObserved: receipts.filter(r => r.observedBlock).length,
      evidenceLimit: 'Startup success or recorded races alone do not mean the test passed; inspect the node:test exit result.',
      boundary: 'native PostgreSQL; actual completion chain incl. quota/authority/retention/M5/M6 SQL; fixture Auth; zero hosted/provider calls',
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), baseline, receipts }, null, 2) + '\n');
    if (!started) { try { process.stderr.write(readFileSync(join(root, 'postgres.log'), 'utf8')); } catch { /* startup may fail before log creation */ } }
    rmSync(root, { recursive: true, force: true });
  }
});
