// Shared synthetic SQL fixture and owned native runner. No hosted URL/credential/provider is accepted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { completionBootstrap } from './account-completion-fixture.mjs';

export const migrationPath = 'backend/supabase/migrations/20261025021046_content_free_retention_evidence.sql';
export const candidate = () => readFileSync(migrationPath, 'utf8');
const nextAction = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm', value: 100,
  comparator: 'within_target', templateVersion: 'rec_v1' };
const migration = name => readFileSync(join('backend/supabase/migrations', name), 'utf8');
export function bootstrapSql() {
  return completionBootstrap() + `
    SET TIME ZONE 'UTC';
    SET ROLE closure_owner;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS attribution_status text NOT NULL DEFAULT 'pending';
    CREATE TABLE public.objective_source_recording(session_id uuid PRIMARY KEY,user_id uuid NOT NULL);
    ${migration('20260803010000_session_attribution_authority.sql')}
    ${migration('20260812030000_progress_cohort_mode_separation_1265.sql')}
    ${migration('20260816223606_metrics_only_additive_1306.sql')}
    ${migration('20260817140000_repoint_analytics_summary_flat_1306.sql')}
    ${migration('20260924150000_progress_evaluation_filler_counts_authority_1471.sql')}
    ${migration('20260810120000_retention_purge_ai_suggestions.sql')}
    ${migration('20261013120000_retention_expiry_without_superuser_1258.sql')}
    ${migration('20261013140000_retention_expiry_typed_empty_array_1258.sql')}
    ${migration('20261020230653_account_pending_completion_journal_1643.sql')}
    ${migration('20261024083000_account_coaching_unknown_fence_1643.sql')}
    RESET ROLE;
  `;
}

let sequence = 0;
export async function seed(db, count = 1, { recovery = false, mismatch = false, recoveryOnly = false, product = 'open_mic' } = {}) {
  sequence++;
  const user = `d1000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${user}','retention-${sequence}@example.test',now());
    UPDATE user_profiles SET subscription_status='pro', stripe_subscription_id='sub_synthetic_${sequence}' WHERE id='${user}';
    SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  const result = await db.query(`INSERT INTO sessions(user_id,status,created_at,transcript,total_words,duration,
      filler_counts,wpm,engine,engine_version,model_name,product)
      SELECT $1,'completed','2026-01-01'::timestamptz + i * interval '1 second',
      'synthetic speech [noise] [music]',100,60,'{"um":2}',100,'private','v2','base',$3
      FROM generate_series(1,$2::integer) AS g(i) RETURNING id`, [user, count, product]);
  const ids = result.rows.map(row => row.id);
  if (recovery) {
    // Model a PRE-INSTALL recovery copy; the new writer guard must forbid recreating one afterwards.
    await db.exec('ALTER TABLE transcript_retention_tombstones DISABLE TRIGGER aa_retention_recovery_write_guard;');
    try {
      await db.query(`INSERT INTO transcript_retention_tombstones(session_id,user_id,transcript,policy_version)
        SELECT id,user_id,$2,'newest_one_v1' FROM sessions WHERE user_id=$1 RETURNING session_id`,
      [user, mismatch ? 'different synthetic content' : 'synthetic speech [noise] [music]']);
    } finally { await db.exec('ALTER TABLE transcript_retention_tombstones ENABLE TRIGGER aa_retention_recovery_write_guard;'); }
    if (recoveryOnly) {
      // Exact pre-policy expired shape, staged without changing any retained application source.
      await db.exec('ALTER TABLE sessions DISABLE TRIGGER aa_retention_content_row_guard; ALTER TABLE sessions DISABLE TRIGGER trg_sessions_set_transcript_state;');
      try { await db.query("UPDATE sessions SET transcript=NULL,transcript_state='expired' WHERE user_id=$1", [user]); }
      finally { await db.exec('ALTER TABLE sessions ENABLE TRIGGER trg_sessions_set_transcript_state; ALTER TABLE sessions ENABLE TRIGGER aa_retention_content_row_guard;'); }
    }
  }
  return { user, ids };
}

export async function replaceTake(db, user, { fail = false } = {}) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  const result = await db.query(`SELECT create_session_and_update_usage($1::jsonb,'private') AS r`,
    [JSON.stringify({ title: 'synthetic active take', duration: 0, product: 'open_mic' })]);
  const id = result.rows[0].r.new_session.id;
  if (fail) await db.exec(`CREATE FUNCTION public.retention_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic_retention_fault'; END; $$;
    CREATE TRIGGER retention_fixture_fault BEFORE DELETE ON transcript_retention_tombstones
    FOR EACH ROW EXECUTE FUNCTION retention_fixture_fault();`);
  try {
    const saved = await db.query(`SELECT complete_session_v2($1,'completed',60,NULL,$2::jsonb,120,NULL,100,'{"um":2}',NULL,'new synthetic take') AS r`,
      [id, JSON.stringify(nextAction)]);
    return { id, receipt: saved.rows[0].r };
  } finally {
    if (fail) await db.exec('DROP TRIGGER retention_fixture_fault ON transcript_retention_tombstones; DROP FUNCTION retention_fixture_fault();');
  }
}

export async function inspect(db, user) {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND transcript IS NOT NULL) AS live,
    (SELECT count(*)::int FROM transcript_retention_tombstones WHERE user_id=$1) AS recovery,
    (SELECT count(*)::int FROM session_progress_content_evidence WHERE user_id=$1) AS snapshots,
    (SELECT count(*)::int FROM session_progress_evaluations WHERE user_id=$1) AS evaluations,
    (SELECT count(*)::int FROM transcript_retention_expiry_grants) AS grants`, [user])).rows[0];
}

export async function settle(db, user, id) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  await db.query(`INSERT INTO session_attribution_authority(session_id,user_id,engine_class,engine,engine_version,model_id,provider)
    VALUES($1,$2,'private','private','v2','base','transformers-js')`, [id, user]);
  return (await db.query('SELECT record_progress_evaluation($1) AS id', [id])).rows[0].id;
}

export const cases = {
  async pendingAndDelayed(db) {
    const { user, ids } = await seed(db, 1, { recovery: true });
    const before = await db.query('SELECT total_words,duration,wpm,filler_counts FROM sessions WHERE id=$1', [ids[0]]);
    assert.equal((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, null, 'pending attribution stays pending');
    const replacement = await replaceTake(db, user);
    assert.equal(replacement.receipt.success, true, 'successful replacement is reported');
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 1, evaluations: 0, grants: 0 }, 'both older plaintext copies are gone before delayed attribution');
    assert.deepEqual((await db.query('SELECT total_words,duration,wpm,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before.rows, 'numeric history remains byte-equivalent');
    const evaluation = await settle(db, user, ids[0]); assert.ok(evaluation, 'delayed evaluation completes after erasure');
    const row = (await db.query('SELECT eligible,error_marker_count,word_count,clarity_raw FROM session_progress_evaluations WHERE id=$1', [evaluation])).rows[0];
    assert.equal(row.eligible, true); assert.equal(row.error_marker_count, 2, 'real marker count survives erasure, never imputed zero');
    assert.equal(row.word_count, 100); assert.equal(row.clarity_raw, 91, 'same clarity formula as before erasure');
    await db.query("UPDATE sessions SET transcript='late synthetic restoration',transcript_state='available' WHERE id=$1", [ids[0]]);
    assert.equal((await db.query('SELECT transcript FROM sessions WHERE id=$1', [ids[0]])).rows[0].transcript, null, 'late writes cannot restore expired text');
    await db.query(`UPDATE sessions SET ai_suggestions='{"synthetic":"late derived coaching"}'::jsonb WHERE id=$1`, [ids[0]]);
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions,
      null, 'late coaching cannot restore content after transcript expiry');
    assert.equal((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, evaluation, 'terminal evaluation is idempotent');
    return true;
  },
  async failedSave(db) {
    const { user } = await seed(db, 1, { recovery: true });
    const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user, { fail: true }), /synthetic_retention_fault/, 'fault is injected inside the atomic replacement');
    assert.deepEqual(await inspect(db, user), before, 'failed replacement removes no old text and commits no snapshot');
    return true;
  },
  async mismatchedCopies(db) {
    const { user } = await seed(db, 1, { recovery: true, mismatch: true }); const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user), /retention_recovery_source_mismatch/);
    assert.deepEqual(await inspect(db, user), before, 'contradictory copies never silently choose one or partially erase'); return true;
  },
  async recoveryOnly(db) {
    const { user } = await seed(db, 2, { recovery: true, recoveryOnly: true });
    await replaceTake(db, user);
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 2, evaluations: 0, grants: 0 }, 'expired recovery-only rows belong to the shared outgoing scope'); return true;
  },
  async distinct500(db) {
    const { user } = await seed(db, 500, { recovery: true });
    await replaceTake(db, user);
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 500, evaluations: 0, grants: 0 }, 'two copies each count as500 distinct sessions, not1000'); return true;
  },
  async distinct501(db) {
    const { user } = await seed(db, 501); const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user), /retention_outgoing_limit_exceeded/);
    assert.deepEqual(await inspect(db, user), before, 'candidate501 refuses before capture/deletion and rolls back replacement'); return true;
  },
  async startAndFailedStatus(db) {
    const { user } = await seed(db); const before = await inspect(db, user);
    const created = (await db.query(`SELECT create_session_and_update_usage($1::jsonb,'private') AS r`,
      [JSON.stringify({ title: 'synthetic start', duration: 0, product: 'open_mic' })])).rows[0].r;
    const id = created.new_session.id;
    await db.query("UPDATE sessions SET status='failed' WHERE id=$1", [id]);
    assert.deepEqual(await inspect(db, user), before, 'Start/failed status never expires previous text'); return true;
  },
  async deniedSnapshotAndRecoveryWrites(db) {
    const { user, ids } = await seed(db); await db.exec('SET ROLE service_role;');
    await assert.rejects(db.exec('SELECT * FROM session_progress_content_evidence'), /permission denied/, 'service role cannot forge private snapshot authority');
    await db.exec('SET ROLE closure_owner;');
    await assert.rejects(db.query(`INSERT INTO transcript_retention_tombstones(session_id,user_id,transcript,policy_version)
      VALUES($1,$2,'late plaintext','newest_one_v1')`, [ids[0], user]), /retention_plaintext_recovery_write_refused/, 'old recovery writers cannot create phantom copies'); return true;
  },
  async snapshotUnavailable(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    await db.query('DELETE FROM session_progress_content_evidence WHERE session_id=$1', [ids[0]]);
    assert.equal(await settle(db, user, ids[0]), null, 'missing snapshot remains unavailable, not a zero or no_transcript terminal verdict'); return true;
  },
  async lateDerivedWrite(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    const before = (await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows;
    await db.query('UPDATE sessions SET ai_suggestions=$2::jsonb WHERE id=$1',
      [ids[0], JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'Synthetic late control', what_to_try_next: 'Synthetic next step' })]);
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions,
      null, 'expired derived prose cannot be restored at the actual session UPDATE boundary');
    assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
    return true;
  },
  async guardedLateCoaching(db) {
    const { user, ids } = await seed(db);
    const operation = (await db.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await db.exec('SET ROLE authenticated;');
    const quota = (await db.query('SELECT consume_ai_suggestion_quota(3) AS r')).rows[0].r;
    assert.equal(quota.allowed, true, 'guarded writer fixture has real authenticated quota admission');
    assert.equal(quota.used, 1);
    await db.exec('SET ROLE service_role;');
    await db.query('SELECT begin_account_coaching_v1($1,$2,$3) AS r', [user, ids[0], operation]);
    await db.exec('SET ROLE closure_owner;');
    await replaceTake(db, user);
    const before = (await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows;
    const model = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8')).model;
    const payload = JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'Synthetic grounded control', what_to_try_next: 'Synthetic next step' });
    await db.exec('SET ROLE service_role;');
    try {
      const persist = () => db.query(`SELECT persist_account_coaching_v1($1,true,$2,$3,$4::jsonb,
        'google_gemini',$5,'user_utc_day',(now() AT TIME ZONE 'UTC')::date,3,1) AS r`, [operation, ids[0], user, payload, model]);
      await assert.rejects(persist(), /session is missing or unowned/, 'actual W1 to W2 late completion cannot restore expired coaching');
      await assert.rejects(persist(), /session is missing or unowned/, 'identical late completion retry cannot restore expired coaching');
    } finally { await db.exec('SET ROLE closure_owner;'); }
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions, null);
    assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
    assert.equal((await db.query('SELECT phase FROM account_coaching_operations WHERE operation_id=$1', [operation])).rows[0].phase,
      'admitted', 'refusing the late write does not fabricate a terminal provider outcome');
    return true;
  },
  async snapshotVersionUnavailable(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    const pin = (await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='public.session_progress_content_evidence'::regclass AND contype='c'
        AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.session_progress_content_evidence'::regclass
          AND attname='marker_pattern_version')]::smallint[]`)).rows[0];
    assert.match(pin.conname, /^[a-z_0-9]+$/);
    // Stage an explicit FUTURE-format fixture. The production constraint itself rejects it today.
    await db.exec(`ALTER TABLE session_progress_content_evidence DROP CONSTRAINT ${pin.conname};`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_constraint WHERE conname=$1', [pin.conname])).rows[0].n, 0, 'future-version fixture actually removed the selected version constraint');
    try {
      await db.query("UPDATE session_progress_content_evidence SET marker_pattern_version='future_unrecognized' WHERE session_id=$1", [ids[0]]);
      assert.equal(await settle(db, user, ids[0]), null, 'unknown pattern version remains unavailable, never reinterpreted as current evidence');
    } finally {
      await db.query("UPDATE session_progress_content_evidence SET marker_pattern_version='error_tags_v1' WHERE session_id=$1", [ids[0]]);
      await db.exec(`ALTER TABLE session_progress_content_evidence ADD CONSTRAINT ${pin.conname} ${pin.definition};`);
    }
    assert.ok((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, 'recognized restored metadata can finish without restoring text');
    return true;
  },
  async atCapAndReplay(db) {
    const { user } = await seed(db, 1, { recovery: true });
    const key = 'aa000000-0000-4000-8000-000000000001';
    const body = JSON.stringify({ title: 'synthetic recovered take', duration: 600, total_words: 120,
      transcript: 'synthetic at-cap recovery', filler_counts: { um: 2 }, product: 'open_mic', next_action_signal: nextAction });
    const first = (await db.query("SELECT create_session_and_update_usage($1::jsonb,'private',$2::uuid) AS r", [body, key])).rows[0].r;
    assert.equal(first.new_session.status, 'completed', 'the real at-cap create saves and converges');
    const before = await inspect(db, user);
    const replay = (await db.query("SELECT create_session_and_update_usage($1::jsonb,'private',$2::uuid) AS r", [body, key])).rows[0].r;
    assert.equal(replay.new_session.id, first.new_session.id); assert.deepEqual(await inspect(db, user), before, 'response-loss replay creates no additional snapshot or content');
    assert.equal(before.recovery, 0); assert.equal(before.live, 1); return true;
  },
  async crossUser(db) {
    const first = await seed(db); await replaceTake(db, first.user);
    const second = await seed(db); const before = await inspect(db, first.user);
    await assert.rejects(db.query('SELECT record_progress_evaluation($1) AS id', [first.ids[0]]), /session not found for this user/);
    assert.deepEqual(await inspect(db, first.user), before, 'another user cannot read or alter the snapshot/evaluation');
    await replaceTake(db, second.user);
    assert.deepEqual(await inspect(db, first.user), before, 'replacement remains confined to its own user'); return true;
  },
  async rollbackCompatibility(db) {
    const { user } = await seed(db); const saved = await replaceTake(db, user);
    const definition = (await db.query("SELECT pg_get_functiondef('public.sessions_set_transcript_state()'::regprocedure) AS body")).rows[0].body;
    const original = migration('20261013120000_retention_expiry_without_superuser_1258.sql').match(/CREATE OR REPLACE FUNCTION public\.sessions_set_transcript_state\(\)[\s\S]*?\n\$\$;/)?.[0];
    assert.ok(original); await db.exec(original);
    try {
      assert.equal((await db.query('SELECT retention_content_free_compatible() AS ok')).rows[0].ok, false, 'old rollback function identity is detected');
      await db.query('UPDATE sessions SET wpm=wpm WHERE id=$1', [saved.id]);
      await assert.rejects(db.query("UPDATE sessions SET transcript='synthetic incompatible write' WHERE id=$1", [saved.id]),
        /retention_snapshot_incompatible/, 'incompatible rollback holds affected writes without recreating text');
    } finally { await db.exec(definition); }
    assert.equal((await db.query('SELECT retention_content_free_compatible() AS ok')).rows[0].ok, true); return true;
  },
};

export const mutants = [
  { name: 'marker count imputed zero', from: 'v_errors := v_content.error_marker_count;', to: 'v_errors := 0;', exercise: 'pendingAndDelayed' },
  { name: 'missing evidence accepted as complete', from: 'IF NOT FOUND THEN RETURN NULL; END IF;',
    to: 'IF NOT FOUND THEN v_content.has_nonblank := true; v_content.error_marker_count := 0; END IF;', exercise: 'snapshotUnavailable' },
  { name: 'mismatched recovery copy ignored', from: 'v_recovery.transcript IS DISTINCT FROM v_row.transcript', to: 'false', exercise: 'mismatchedCopies' },
  { name: '501 outgoing sessions accepted', from: 'cardinality(v_ids) > p_batch_size', to: 'cardinality(v_ids) > 5000', exercise: 'distinct501' },
  { name: 'late derived-content fence removed', from: "IF OLD.transcript_state = 'expired' THEN NEW.ai_suggestions := NULL; END IF;",
    to: 'IF false THEN NEW.ai_suggestions := NULL; END IF;', exercise: 'lateDerivedWrite' },
];

// No inherited PG URL/credentials, TCP listener, linked Supabase target or network download.
async function nativeFixture(t) {
  const root = mkdtempSync('/private/tmp/rce-'); const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
  const bin = '/opt/homebrew/opt/postgresql@17/bin'; const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', TMPDIR: root };
  const receipt = { root, source: migrationPath, sha256: createHash('sha256').update(candidate()).digest('hex'), syntheticOnly: true, tcp: false, cases: [], cleanupVerified: false };
  let started = false; let statement = 0;
  const run = (name, args, timeout = 20_000) => execFileSync(join(bin, name), args, { env, encoding: 'utf8', timeout });
  t.after(() => {
    if (!started) { writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); return; }
    run('pg_ctl', ['-D', data, '-w', '-t', '10', 'stop', '-m', 'immediate'], 15_000);
    try { run('pg_ctl', ['-D', data, 'status'], 5_000); throw new Error('owned PostgreSQL still running'); }
    catch (e) { if (e.status !== 3) throw e; }
    rmSync(data, { recursive: true, force: true });
    assert.equal(existsSync(join(socket, '.s.PGSQL.55477')), false, 'owned Unix socket is removed');
    receipt.cleanupVerified = true; receipt.dataRemoved = !existsSync(data);
    writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(`native retention receipt: ${join(root, 'receipt.json')}\n`);
  });
  run('initdb', ['-D', data, '-U', 'retention_fixture_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '10', 'start', '-o', `-k ${socket} -p 55477 -c listen_addresses=''`]); started = true;
  receipt.postgresBinaryVersion = run('postgres', ['--version']).trim();
  receipt.owner = { controllerPid: process.pid, postmasterPid: Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0]), data, socket };
  const exec = async text => {
    const path = join(root, `statement-${++statement}.sql`); writeFileSync(path, text);
    return run('psql', ['-h', socket, '-p', '55477', '-U', 'retention_fixture_admin', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', path], 30_000);
  };
  const literal = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : `'${String(x).replaceAll("'", "''")}'`;
  // Each call owns one connection. Synthetic role/subject are explicitly reapplied, never inferred from a prior call.
  let subject = ''; let role = 'closure_owner';
  const prefix = () => `SELECT set_config('request.jwt.claim.sub','${subject}',false); SET ROLE ${role}; SET TIME ZONE 'UTC'; SET statement_timeout='20s'; SET lock_timeout='5s';`;
  const db = {
    exec: async sql => {
      const match = sql.match(/set_config\('request\.jwt\.claim\.sub','([^']+)'/); if (match) subject = match[1];
      const output = await exec(prefix() + sql);
      for (const change of sql.matchAll(/SET ROLE (\w+)|RESET ROLE/g)) role = change[1] ?? 'retention_fixture_admin';
      return output;
    },
    query: async (sql, params = []) => {
      const bound = sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
      if (!/^(SELECT|WITH)\s/i.test(bound.trim()) && !/\bRETURNING\b/i.test(bound)) {
        await exec(prefix() + bound); return { rows: [] };
      }
      const query = /^(SELECT|WITH)\s/i.test(bound.trim()) ? `SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${bound}) q;` : `WITH q AS (${bound}) SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM q;`;
      const output = await exec(prefix() + query); return { rows: JSON.parse(output.trim().split('\n').at(-1)) };
    },
  };
  receipt.serverVersion = (await exec('SELECT version();')).trim();
  await exec(bootstrapSql()); await exec(`SET ROLE closure_owner; ${candidate()}`);
  for (const [name, body] of Object.entries(cases)) {
    let failure;
    await t.test(name, { timeout: 40_000 }, async () => {
      try { await body(db); receipt.cases.push({ name, status: 'PASS' }); }
      catch (error) { failure = error; receipt.cases.push({ name, status: 'FAIL' }); throw error; }
    });
    if (failure) throw failure;
  }
  // Two independent sessions demonstrate the actual same-user profile lock, not a PGlite scheduling claim.
  const { user } = await seed(db); const holderSql = join(root, 'holder.sql');
  writeFileSync(holderSql, `BEGIN; SET ROLE closure_owner; SELECT 1 FROM user_profiles WHERE id='${user}' FOR UPDATE; SELECT 'LOCKED'; SELECT pg_sleep(2); COMMIT;`);
  const holder = spawn(join(bin, 'psql'), ['-h', socket, '-p', '55477', '-U', 'retention_fixture_admin', '-d', 'postgres', '-X', '-qAt', '-f', holderSql], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (holder.exitCode === null) holder.kill('SIGTERM'); });
  await new Promise((resolveLock, rejectLock) => {
    holder.stdout.on('data', chunk => { if (String(chunk).includes('LOCKED')) resolveLock(); });
    holder.on('error', rejectLock);
    holder.on('exit', () => rejectLock(new Error('holder exited before the lock receipt')));
  });
  await assert.rejects(exec(`SELECT set_config('request.jwt.claim.sub','${user}',false); SET lock_timeout='100ms'; SET ROLE closure_owner;
    INSERT INTO sessions(user_id,status,duration,transcript) VALUES('${user}','completed',60,'synthetic concurrent take');`),
  /lock timeout|canceling statement/, 'independent actual session writer blocks on the shared same-user boundary');
  await new Promise((resolveExit, rejectExit) => holder.on('exit', code => code === 0 ? resolveExit() : rejectExit(new Error(`holder exit ${code}`))));
  receipt.cases.push({ name: 'native-profile-serialization', status: 'PASS' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test('owned native PostgreSQL content-free retention', { timeout: 240_000 }, nativeFixture);
}
