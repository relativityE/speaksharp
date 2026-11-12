// AHT-07 run settlement proof (proposal F, tests/db/aht07-run-fence.proposed.sql) on a disposable LOCAL PostgreSQL:
// fixture Auth + the real user_issue_reports migration chain + the proposal. Independent psql sessions prove the
// lock overlap through pg_blocking_pids. No hosted database, no production, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const REPORT_CHAIN = [
  '20260605080000_user_issue_reports.sql',
  '20260605120000_user_issue_reports_optional_user.sql',
  '20260607023000_grant_issue_report_insert.sql',
  '20260710000000_user_issue_reports_category_slugs.sql',
  '20260721130000_report_session_ownership_guard.sql',
  '20260903140000_feedback_kind_severity_contract.sql',
  '20260904150000_share_feedback_redesign.sql',
];
const PROPOSAL = process.env.AHT07_PROPOSAL_OVERRIDE ?? 'tests/db/aht07-run-fence.proposed.sql'; // override only for mutation controls
const FIXTURE = 'tests/db/aht07-run-fence.fixture.sql';

function pgBin(name) {
  for (const v of ['18', '17', '16', '15']) {
    const p = `/usr/lib/postgresql/${v}/bin/${name}`;
    if (existsSync(p)) return p;
  }
  return name;
}

/** One long-lived psql session; `run` sends SQL and resolves with { out, err } once a unique marker comes back. */
class Session {
  constructor(sock, label) {
    this.label = label; this.out = ''; this.err = ''; this.n = 0;
    this.p = spawn(pgBin('psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=0', '-h', sock, '-p', '5432', '-U', 'supabase_admin', 'postgres'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    this.p.stdout.on('data', (d) => { this.out += d; });
    this.p.stderr.on('data', (d) => { this.err += d; });
    this.p.stdin.on('error', () => { /* backend terminated on purpose by a test */ });
  }
  send(sql) {
    const marker = `__done_${this.label}_${++this.n}__`;
    const outStart = this.out.length; const errStart = this.err.length;
    this.p.stdin.write(`${sql}\n\\echo ${marker}\n`);
    return (async () => {
      for (let i = 0; i < 600; i++) {
        const at = this.out.indexOf(marker, outStart);
        if (at >= 0) return { out: this.out.slice(outStart, at).trim(), err: this.err.slice(errStart).trim() };
        await delay(25);
      }
      throw new Error(`${this.label}: no answer to ${sql.slice(0, 80)}`);
    })();
  }
  async pid() { return (await this.send('SELECT pg_backend_pid();')).out; }
  close() { this.p.stdin.end(); }
}

test('AHT-07 run settlement: run-owned id tied to exact idempotency keys, fenced, durable settlement record', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aht07-fence-'));
  const data = join(dir, 'data'); const sock = dir;
  // initdb refuses root; in a root sandbox, run the server as the local postgres account (never a hosted database).
  const owner = {};
  if (process.getuid?.() === 0) {
    owner.uid = Number(execFileSync('id', ['-u', 'postgres']).toString().trim());
    owner.gid = Number(execFileSync('id', ['-g', 'postgres']).toString().trim());
    chownSync(dir, owner.uid, owner.gid);
  }
  execFileSync(pgBin('initdb'), ['-D', data, '-U', 'supabase_admin', '--auth=trust', '-E', 'UTF8'], { stdio: 'ignore', ...owner });
  execFileSync(pgBin('pg_ctl'), ['-D', data, '-w', '-l', join(dir, 'log'), '-o', `-k ${sock} -c listen_addresses='' -p 5432`, 'start'], { stdio: 'ignore', ...owner });
  const sessions = [];
  t.after(() => {
    for (const s of sessions) s.close();
    try { execFileSync(pgBin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore', ...owner }); } catch { /* already down */ }
    rmSync(dir, { recursive: true, force: true });
  });
  const open = (label) => { const s = new Session(sock, label); sessions.push(s); return s; };
  const psqlFile = (sql) => execFileSync(pgBin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', '5432', '-U', 'supabase_admin', 'postgres'],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();

  // Build: fixture Auth (with Supabase's default grants), the real report chain as the (non-superuser) owner, the proposal.
  psqlFile(readFileSync(FIXTURE, 'utf8'));
  for (const f of REPORT_CHAIN) psqlFile(`SET ROLE postgres_owner;\n${readFileSync(join('backend/supabase/migrations', f), 'utf8')}`);
  psqlFile(`SET ROLE postgres_owner;\n${readFileSync(PROPOSAL, 'utf8')}`);

  const admin = open('admin');
  const S = open('service');                                   // the runner / sweeper service-role connection
  const q = async (sql) => { const r = await admin.send(/;\s*$/.test(sql) ? sql : `${sql};`); assert.equal(r.err, '', r.err); return r.out; };
  const svc = async (s, sql) => s.send(`BEGIN; SET LOCAL ROLE service_role; ${sql}; COMMIT;`);
  const svcOk = async (sql) => { const r = await svc(S, sql); assert.equal(r.err, '', r.err); return r.out; };
  const svcErr = async (sql) => (await svc(S, sql)).err;
  const claims = (uid, sid) => JSON.stringify(sid ? { sub: uid, session_id: sid, role: 'authenticated' } : { sub: uid, role: 'authenticated' });
  /** The app's plain insert (issueReportService.submit): the draft's idempotency key, user_id or NULL. */
  const report = (ownerId, key) => `INSERT INTO public.user_issue_reports
      (user_id, category, severity, title, description, page_url, metadata, idempotency_key)
      VALUES (${ownerId === null ? 'NULL' : `'${ownerId}'`}, 'something_else', 'low', 'Fence check', 'Automated fence check.', '/analytics', '{}', ${key ? `'${key}'` : 'NULL'});`;
  const asUser = (uid, sid, sql) => `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims(uid, sid)}', true); ${sql}`;
  const tryAs = async (s, uid, sid, sql, end = 'ROLLBACK;') => (await s.send(asUser(uid, sid, sql) + ` ${end}`)).err;
  const countAll = async () => Number(await q('SELECT count(*) FROM public.user_issue_reports'));
  const countKeys = async (keys) => Number(await q(`SELECT count(*) FROM public.user_issue_reports WHERE idempotency_key IN ('${keys.join("','")}')`));
  const runState = async (ct) => q(`SELECT state FROM public.ct_runs WHERE ct_run = '${ct}'`);
  const waitBlocked = async (blocked, by) => {
    for (let i = 0; i < 200; i++) {
      const pids = await q(`SELECT pg_blocking_pids(${blocked})::text`);
      if (pids.replace(/[{}]/g, '').split(',').includes(String(by))) return true;
      await delay(25);
    }
    return false;
  };

  let attempt = 0;
  const nextEmail = () => `rwt-journey-fence-${++attempt}-4242@example.com`;
  const registerSql = (email, cap = 4) =>
    `SELECT public.ct_register_run('relativityE/speaksharp', '.github/workflows/rc-gates.yml', 4242, ${attempt}, 'feedback-boundary', '${email}', ${cap})`;
  /** Signup as GoTrue would: the account row (the claim trigger fires in this transaction) and two login sessions. */
  const signupSql = (a) => `INSERT INTO auth.users (id, email) VALUES ('${a.uid}', '${a.email}'); INSERT INTO auth.sessions VALUES ('${a.signupSid}', '${a.uid}'), ('${a.sid}', '${a.uid}');`;
  const account = (email) => ({ email, uid: randomUUID(), signupSid: randomUUID(), sid: randomUUID() });
  const registered = async (cap = 4) => { const a = account(nextEmail()); a.ct = await svcOk(registerSql(a.email, cap)); return a; };
  const newRun = async (cap = 4) => { const a = await registered(cap); await q(signupSql(a)); return a; };
  /** What the runner does before each Send: read the draft's key (sessionStorage) and register it. */
  const key = async (a) => { const k = randomUUID(); await svcOk(`SELECT public.ct_register_key('${a.ct}', '${k}')`); return k; };
  const fence = async (a) => svcOk(`SELECT public.ct_fence_run('${a.ct}', 10000)`);
  const settle = async (a, s = S) => svc(s, `SELECT public.ct_settle_run('${a.ct}')`);
  const settlement = async (a) => q(`SELECT string_agg(idempotency_key || '=' || coalesce(outcome, '-'), ',' ORDER BY idempotency_key) FROM public.ct_run_keys WHERE ct_run = '${a.ct}'`);

  await t.test('T1 catalogue: no login session or token stored; service-only functions; pinned search_path; no client grants', async () => {
    const service = new Set(['ct_register_run', 'ct_register_key', 'ct_fence_run', 'ct_run_account', 'ct_settle_run', 'ct_settlement']);
    const rows = (await q(`SELECT p.proname || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' ||
        CASE WHEN p.proacl IS NULL THEN 'public-default' ELSE coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a), false)::text END || '|' ||
        has_function_privilege('anon', p.oid, 'EXECUTE') || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || '|' ||
        has_function_privilege('service_role', p.oid, 'EXECUTE') || '|' || p.prosecdef
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'ct\\_%' ORDER BY 1`)).split('\n');
    assert.equal(rows.length, 10, rows.join('\n'));
    for (const row of rows) {
      const [name, config, pub, anon, authd, svcRole, definer] = row.split('|');
      assert.equal(config, 'search_path=""', `${name} pins search_path`);
      assert.equal(pub, 'false', `${name}: no PUBLIC execute`);
      assert.equal(anon, 'false', `${name}: no anon execute`);
      assert.equal(authd, 'false', `${name}: no authenticated execute`);
      assert.equal(svcRole, String(service.has(name)), `${name}: service_role execute only for service steps`);
      if (!name.endsWith('_lock_key')) assert.equal(definer, 'true', `${name} is SECURITY DEFINER`);
    }
    const grants = await q(`SELECT string_agg(t || ':' || r || ':' || p, ',') FROM unnest(array['public.ct_runs','public.ct_run_keys']) t,
      unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE has_table_privilege(r, t, p)`);
    assert.equal(grants, '', 'no client or service grant on the run tables');
    assert.equal(await q(`SELECT string_agg(table_name || '.' || column_name, ',') FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name LIKE 'ct\\_%' AND (column_name ~ '(session|token|jwt)')`), '', 'no login session, token or JWT column');
    assert.equal(await q(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'user_issue_reports' AND column_name LIKE 'ct\\_%'`), '0',
      'no new column on user_issue_reports');
    // Supabase default grants give authenticated table-level UPDATE on reports; the defence is no UPDATE policy plus the
    // key-immutability trigger (T6), not column grants.
    assert.equal(await q(`SELECT has_table_privilege('authenticated', 'public.user_issue_reports', 'UPDATE')`), 't');
    assert.equal(await q(`SELECT count(*) FROM pg_policies WHERE tablename = 'user_issue_reports' AND cmd IN ('UPDATE','ALL')`), '0');
    assert.equal(await q(`SELECT count(*) FROM pg_policies WHERE tablename = 'user_issue_reports' AND cmd IN ('INSERT','ALL')
      AND roles && array['anon','public']::name[]`), '0', 'anon has no insert path, so every insert carries an identity');
  });

  await t.test('T2 signup records the uid atomically; only keys registered to the run are admitted, by the run account only', async () => {
    // Registration and signup of the same email serialize on the per-email lock: signup waits, then records the uid.
    const a = account(nextEmail());
    const reg = open('reg'); const up = open('signup');
    const [regPid, upPid] = [await reg.pid(), await up.pid()];
    const regOut = await reg.send(`BEGIN; SET LOCAL ROLE service_role; ${registerSql(a.email)};`);
    assert.equal(regOut.err, ''); a.ct = regOut.out;
    const signing = up.send(`BEGIN; ${signupSql(a)}`);
    assert.ok(await waitBlocked(upPid, regPid), 'signup waits for the in-flight registration of its email');
    await reg.send('COMMIT;');
    assert.equal((await signing).err, ''); await up.send('COMMIT;');
    assert.equal(await q(`SELECT state || ':' || (account_uid = '${a.uid}') FROM public.ct_runs WHERE ct_run = '${a.ct}'`), 'open:true');
    assert.match(await svcErr(registerSql(a.email)), /ct_register_account_exists/);
    // Before any key is registered, every insert by the run account is refused: either session, no session claim,
    // user_id set or NULL, no key or a made-up key.
    const w = open('pre');
    for (const sid of [a.signupSid, a.sid, null]) {
      for (const who of [a.uid, null]) {
        assert.match(await tryAs(w, a.uid, sid, report(who, null)), /ct_key_unregistered/);
        assert.match(await tryAs(w, a.uid, sid, report(who, randomUUID())), /ct_key_unregistered/);
      }
    }
    // A registered key is the permit: admitted once (a retry of the same key is the app's idempotent replay).
    const k1 = await key(a);
    assert.equal(await tryAs(w, a.uid, a.sid, report(null, k1), 'COMMIT;'), '');
    assert.match(await tryAs(w, a.uid, a.sid, report(null, k1)), /user_issue_reports_idempotency_key_unique/);
    assert.equal(await countKeys([k1]), 1);
    // Another run's key is refused for this account; this run's key is refused for every other identity.
    const b = await newRun(); const kb = await key(b);
    assert.match(await tryAs(w, a.uid, a.sid, report(null, kb)), /ct_key_unregistered/);
    const realUser = account(`real-${randomUUID()}@example.org`); await q(signupSql(realUser));
    const k2 = await key(a);
    assert.match(await tryAs(w, realUser.uid, realUser.sid, report(null, k2)), /ct_key_not_yours/);
    assert.match(await tryAs(w, realUser.uid, realUser.sid, report(realUser.uid, k2)), /ct_key_not_yours/);
    assert.match(await svcErr(report(null, k2)), /ct_key_not_yours/, 'the service role cannot write under a run key either');
    // Key registration refusals: null, duplicate, a key some report already uses, over the cap, before signup.
    assert.match(await svcErr(`SELECT public.ct_register_key('${a.ct}', NULL)`), /ct_key_null/);
    assert.match(await svcErr(`SELECT public.ct_register_key('${a.ct}', '${k2}')`), /ct_key_taken/);
    assert.match(await svcErr(`SELECT public.ct_register_key('${b.ct}', '${k1}')`), /ct_key_taken/);
    const used = randomUUID();
    assert.equal(await tryAs(w, realUser.uid, realUser.sid, report(realUser.uid, used), 'COMMIT;'), '');
    assert.match(await svcErr(`SELECT public.ct_register_key('${a.ct}', '${used}')`), /ct_key_already_used/);
    await key(a); await key(a);                                                    // 4 of cap 4
    assert.match(await svcErr(`SELECT public.ct_register_key('${a.ct}', gen_random_uuid())`), /ct_key_over_cap/);
    const c = await registered();
    assert.match(await svcErr(`SELECT public.ct_register_key('${c.ct}', gen_random_uuid())`), /ct_key_refused_state/);
  });

  await t.test('T3 an admitted write commits before the fence returns; writes queued behind the fence or later are refused', async () => {
    const r = await newRun(); const [k1, k2, k3] = [await key(r), await key(r), await key(r)];
    const a = open('writerA'); const f = open('fencer'); const c = open('writerC'); const d = open('writerD');
    const [aPid, fPid, cPid] = [await a.pid(), await f.pid(), await c.pid()];
    assert.equal((await a.send(asUser(r.uid, r.sid, report(r.uid, k1)))).err, '');   // inserted, transaction still open
    let fenceDone = false;
    const fencing = svc(f, `SELECT public.ct_fence_run('${r.ct}', 10000)`).then((x) => { fenceDone = true; return x; });
    assert.ok(await waitBlocked(fPid, aPid), 'the fence waits on the admitted write');
    const queued = c.send(asUser(r.uid, r.sid, report(null, k2)) + ' COMMIT;');      // delayed: arrives while the fence waits
    assert.ok(await waitBlocked(cPid, fPid), 'a write arriving while the fence waits queues behind the fence');
    assert.equal(fenceDone, false, 'the fence has not returned while the admitted write is open');
    await a.send('COMMIT;');
    const fenced = await fencing;
    assert.equal(fenced.err, ''); assert.match(fenced.out, /fenced/);
    assert.match((await queued).err, /ct_run_fenced/, 'the queued write is refused');
    assert.match(await tryAs(d, r.uid, r.sid, report(r.uid, k3)), /ct_run_fenced/, 'a later write is refused');
    assert.equal(await countKeys([k1, k2, k3]), 1, 'exactly the admitted write landed');
    assert.match(await svcErr(`SELECT public.ct_register_key('${r.ct}', gen_random_uuid())`), /ct_key_refused_state/, 'no key after the fence');
  });

  await t.test('T4 an admitted write whose client disconnects leaves nothing; the fence still returns', async () => {
    const r = await newRun(); const k = await key(r);
    const a = open('abortA'); const f = open('abortF');
    const [aPid, fPid] = [await a.pid(), await f.pid()];
    await a.send(asUser(r.uid, r.sid, report(r.uid, k)));
    const fencing = svc(f, `SELECT public.ct_fence_run('${r.ct}', 10000)`);
    assert.ok(await waitBlocked(fPid, aPid));
    await q(`SELECT pg_terminate_backend(${aPid})`);                               // client crash mid-write
    assert.match((await fencing).out, /fenced/);
    assert.equal(await countKeys([k]), 0);
  });

  await t.test('T5 fence timeout is a HOLD: the run stays open and nothing is lost', async () => {
    const r = await newRun(); const k = await key(r);
    const a = open('slowA'); const f = open('slowF');
    await a.send(asUser(r.uid, r.sid, report(r.uid, k)));
    const res = await svc(f, `SELECT public.ct_fence_run('${r.ct}', 300)`);
    assert.match(res.err, /lock timeout/);
    await f.send('ROLLBACK;');
    assert.equal(await runState(r.ct), 'open');
    await a.send('COMMIT;');
    assert.equal((await svc(f, `SELECT public.ct_fence_run('${r.ct}', 10000)`)).err, '');
    assert.equal(await countKeys([k]), 1);
    assert.match((await svc(f, `SELECT public.ct_fence_run('${r.ct}', 0)`)).err, /ct_fence_bad_timeout/);
  });

  await t.test('T6 identity, not user_id: run-account inserts while open, after the fence and after deletion; keys immutable', async () => {
    const r = await newRun(); const [k1, k2, k3] = [await key(r), await key(r), await key(r)];
    const w = open('neg'); const s = open('upd');
    // Open: user_id NULL under a registered key is admitted (any session of the account: the key, not the session, is the
    // permit); the same account without a registered key is refused.
    assert.equal(await tryAs(w, r.uid, r.signupSid, report(null, k1), 'COMMIT;'), '');
    assert.equal(await tryAs(w, r.uid, null, report(r.uid, k2), 'COMMIT;'), '');
    assert.match(await tryAs(w, r.uid, r.sid, report(null, null)), /ct_key_unregistered/);
    // Keys are immutable for every role on run rows (service role, and a client even under a permissive UPDATE policy),
    // and a real row cannot be moved onto a run key.
    assert.match((await svc(s, `UPDATE public.user_issue_reports SET idempotency_key = gen_random_uuid() WHERE idempotency_key = '${k1}'`)).err, /ct_key_immutable/);
    await s.send('ROLLBACK;');
    const probe = await s.send(`BEGIN; CREATE POLICY ct_probe_any_update ON public.user_issue_reports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
      SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims(r.uid, r.sid)}', true);
      UPDATE public.user_issue_reports SET idempotency_key = NULL WHERE idempotency_key = '${k2}'; ROLLBACK;`);
    assert.match(probe.err, /ct_key_immutable/);
    const other = randomUUID();
    assert.equal((await svc(s, report(null, other))).err, '');                    // an ordinary row
    assert.match((await svc(s, `UPDATE public.user_issue_reports SET idempotency_key = '${k3}' WHERE idempotency_key = '${other}'`)).err, /ct_key_immutable/);
    await s.send('ROLLBACK;');
    assert.equal(await countKeys([k3]), 0);
    // Fenced: every session, with or without user_id, session claim or key, is refused.
    await fence(r);
    for (const sid of [r.sid, r.signupSid, randomUUID(), null]) {
      for (const who of [r.uid, null]) {
        for (const k of [k3, null, randomUUID()]) assert.match(await tryAs(w, r.uid, sid, report(who, k)), /ct_run_fenced/);
      }
    }
    // Deleted: rows survive with user_id NULL under their keys; the classification survives (no FK on account_uid).
    await q(`DELETE FROM auth.users WHERE id = '${r.uid}'`);
    assert.equal(await q(`SELECT count(*) FROM public.user_issue_reports WHERE idempotency_key IN ('${k1}','${k2}') AND user_id IS NULL`), '2');
    for (const sid of [r.sid, r.signupSid, null]) assert.match(await tryAs(w, r.uid, sid, report(null, k3)), /ct_run_fenced/);
    // Abnormal order (account deleted while the run is still open): the stale token is refused too.
    const r2 = await newRun(); const k4 = await key(r2);
    await q(`DELETE FROM auth.users WHERE id = '${r2.uid}'`);
    assert.match(await tryAs(w, r2.uid, r2.sid, report(null, k4)), /ct_run_account_gone/);
    assert.equal(await countKeys([k4]), 0);
  });

  await t.test('T7 crash before signup or before any write: settled by the uid recorded at signup, never by email', async () => {
    const w = open('crash');
    // A: signed up, crashed before any key. Fence, delete the recorded uid, settle with an empty record.
    const a = await newRun();
    assert.equal(await fence(a), 'fenced');
    assert.equal(await svcOk(`SELECT public.ct_run_account('${a.ct}')`), a.uid, 'the deletion target is the uid recorded at signup');
    assert.match((await settle(a)).err, /ct_settle_account_still_exists/);
    await q(`DELETE FROM auth.users WHERE id = '${a.uid}'`);
    assert.match(await tryAs(w, a.uid, a.signupSid, report(null, null)), /ct_run_fenced/, 'signup token after deletion');
    assert.equal((await settle(a)).out, '0:0');
    assert.equal(await q(`SELECT state || ':' || settled_deleted || ':' || settled_absent FROM public.ct_runs WHERE ct_run = '${a.ct}'`), 'settled:0:0');
    // B: registered, crashed before signup. Fencing first makes the email unclaimable: no account can appear later.
    const b = await registered();
    assert.equal(await fence(b), 'fenced');
    assert.match((await w.send(`BEGIN; ${signupSql(account(b.email))} ROLLBACK;`)).err, /ct_run_email_not_claimable/);
    assert.equal(await q(`SELECT count(*) FROM auth.users WHERE email = '${b.email}'`), '0');
    assert.equal(await svcOk(`SELECT public.ct_run_account('${b.ct}')`), '');
    assert.equal((await settle(b)).out, '0:0');
    // C: fence racing an in-flight signup: the fence waits for the signup's claim and then records it.
    const c = await registered();
    const up = open('raceSignup'); const f = open('raceFence');
    const [upPid, fPid] = [await up.pid(), await f.pid()];
    assert.equal((await up.send(`BEGIN; ${signupSql(c)}`)).err, '');
    const fencing = svc(f, `SELECT public.ct_fence_run('${c.ct}', 10000)`);
    assert.ok(await waitBlocked(fPid, upPid), 'the fence waits for the in-flight signup');
    await up.send('COMMIT;');
    assert.match((await fencing).out, /fenced/);
    assert.equal(await svcOk(`SELECT public.ct_run_account('${c.ct}')`), c.uid);
    assert.match(await tryAs(w, c.uid, c.signupSid, report(null, null)), /ct_run_fenced/);
  });

  await t.test('T8 settlement: exact keys, lost responses, competing fencers and settlers, crash after deletion, N vs N+1', async () => {
    const real = account(`real-${randomUUID()}@example.org`);
    await q(signupSql(real));
    const rw = open('realW');
    const realKey = randomUUID();
    assert.equal(await tryAs(rw, real.uid, real.sid, report(real.uid, realKey), 'COMMIT;'), '');
    // Attempt N: k1 sent normally; k2 committed but its response was lost (connection killed after COMMIT); k3 registered
    // but the request never committed (killed mid-write). Rerun attempt N+1 has its own run and key.
    const n = await newRun(); const next = await newRun();
    const [k1, k2, k3] = [await key(n), await key(n), await key(n)]; const kNext = await key(next);
    const w = open('cleanW'); const lost = open('lostW'); const dead = open('deadW');
    assert.equal(await tryAs(w, n.uid, n.sid, report(n.uid, k1), 'COMMIT;'), '');
    assert.equal(await tryAs(lost, n.uid, n.sid, report(null, k2), 'COMMIT;'), '');
    await q(`SELECT pg_terminate_backend(${await lost.pid()})`);
    const deadPid = await dead.pid();
    await dead.send(asUser(n.uid, n.sid, report(n.uid, k3)));
    await q(`SELECT pg_terminate_backend(${deadPid})`);
    assert.equal(await tryAs(w, next.uid, next.sid, report(next.uid, kNext), 'COMMIT;'), '');
    // Two competing fencers: one fences, the other waits and reports the same state.
    const f1 = open('fence1'); const f2 = open('fence2');
    const [x1, x2] = await Promise.all([svc(f1, `SELECT public.ct_fence_run('${n.ct}', 10000)`), svc(f2, `SELECT public.ct_fence_run('${n.ct}', 10000)`)]);
    assert.equal(x1.err + x2.err, ''); assert.deepEqual([x1.out, x2.out], ['fenced', 'fenced']);
    assert.match((await settle(n)).err, /ct_settle_account_still_exists/);
    await q(`DELETE FROM auth.users WHERE id = '${n.uid}'`);
    assert.equal(await q(`SELECT count(*) FROM public.user_issue_reports WHERE idempotency_key IN ('${k1}','${k2}') AND user_id IS NULL`), '2', 'retained after deletion');
    // Crash after deletion, then two settlers from fresh connections: both return the same result; one deletes.
    const total = await countAll();
    const s1 = open('settle1'); const s2 = open('settle2');
    const [c1, c2] = await Promise.all([settle(n, s1), settle(n, s2)]);
    assert.equal(c1.err + c2.err, ''); assert.deepEqual([c1.out, c2.out], ['2:1', '2:1']);
    assert.equal(await countAll(), total - 2, 'exactly the two run rows were deleted');
    assert.equal(await settlement(n), [`${k1}=deleted`, `${k2}=deleted`, `${k3}=absent`].sort().join(','), 'durable per-key settlement record');
    assert.equal(await runState(n.ct), 'settled');
    assert.equal(await countKeys([kNext]), 1, 'rerun attempt N+1 untouched');
    assert.equal(await countKeys([realKey]), 1, 'real user report untouched');
    assert.equal(await fence(n), 'settled', 'the tombstone stays settled');
    assert.match(await tryAs(w, n.uid, n.sid, report(null, randomUUID())), /ct_run_fenced/, 'and keeps refusing the run account');
    assert.match(await tryAs(rw, real.uid, real.sid, report(null, k3)), /ct_key_not_yours/, 'a settled absent key stays unusable');
    // Zero-key run: settled with a durable record of 0 deleted, 0 absent.
    const zero = await newRun(); await fence(zero);
    await q(`DELETE FROM auth.users WHERE id = '${zero.uid}'`);
    assert.equal((await settle(zero)).out, '0:0');
    assert.equal(await q(`SELECT state || ':' || settled_deleted || ':' || settled_absent FROM public.ct_runs WHERE ct_run = '${zero.ct}'`), 'settled:0:0');
    // Settling an unfenced or unknown run is a HOLD.
    assert.match((await settle(next)).err, /ct_settle_requires_fence/);
    assert.match(await svcErr(`SELECT public.ct_settle_run(gen_random_uuid())`), /ct_settle_unknown_run/);
  });

  await t.test('T9 real users are unaffected; clients cannot read the run tables, call its steps, or take a run email', async () => {
    const u = account(`someone-${randomUUID()}@example.org`);
    await q(signupSql(u));                                                         // ordinary signup: claim trigger is a no-op
    const w = open('real');
    const all = await countAll();
    assert.equal(await tryAs(w, u.uid, u.sid, report(u.uid, randomUUID()), 'COMMIT;'), '', 'own fresh key: saved as before');
    assert.equal(await tryAs(w, u.uid, u.sid, report(null, null), 'COMMIT;'), '', 'anonymous report without a key: saved as before');
    assert.equal(await tryAs(w, u.uid, null, report(null, randomUUID()), 'COMMIT;'), '', 'no session claim: unaffected for real users');
    assert.equal(await countAll(), all + 3);
    for (const sql of ['SELECT count(*) FROM public.ct_runs;', 'SELECT count(*) FROM public.ct_run_keys;',
      'SELECT public.ct_fence_run(gen_random_uuid(), 10);', 'SELECT public.ct_settle_run(gen_random_uuid());',
      'SELECT public.ct_register_key(gen_random_uuid(), gen_random_uuid());',
      `SELECT public.ct_register_run('a/b', '.github/workflows/x.yml', 1, 1, 'x', 'x@example.com', 0);`]) {
      assert.match(await tryAs(w, u.uid, u.sid, sql), /permission denied/, sql);
    }
    const r = await registered();
    assert.match((await w.send(`UPDATE auth.users SET email = '${r.email}' WHERE id = '${u.uid}';`)).err, /ct_run_email_not_claimable/);
    assert.equal(await runState(r.ct), 'registered');
  });
});
